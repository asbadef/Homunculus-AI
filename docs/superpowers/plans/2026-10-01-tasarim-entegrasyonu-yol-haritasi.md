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

**Dalga 2'de kullanıcının verdiği kararlar (05.10.2026; [dalga 2 planı](2026-10-04-g1-dalga2-kabuk-giris.md)):**

12. **Nöbet bitimine (üst çubuk):** ✅ **gösterilmiyor.** Grup 1'de kaynağı yok (kişinin nöbet
    ataması `nurse_bed_assignments`'ı yazan ekran yok, hekimin ataması hiç yok; hastane çapında
    nöbet saati tanımlı değil).
13. **AD kesintisinde kilit:** ✅ **kapalı kalır (fail closed).** Dizin yanıt vermezken AD hesabının
    kilitli ekranı açılamaz (503); klinisyen çıkış yapıp yerel bir hesapla girer. Karar 11 (b)
    kilit ekranına da uzanır: bir klinisyenin AD giriş adını bilen biri, yanlış parolalarla onun
    kilitli ekranını da (girişi gibi) en az 15 dakika 429'da tutabilir — o bekler, yönetici diziyi
    bir kez açar ya da istasyonda bir meslektaşı girer (runbook, "A locked screen counts too").
14. **Kilit süresi:** ✅ **10 dakika**, `SCREEN_LOCK_IDLE_MINUTES` ile değiştirilebilir (1–60).
    Kişisel oturum her zaman kilitlenir, "hiç" yok (duvar ekranı Grup 2'nin kiosk modu); 12 saatten
    uzun kilitli kalan tarayıcı kendiliğinden çıkış yapar (`SCREEN_LOCK_SIGNOUT_HOURS`, 1–72) —
    mühendislik kararı.
15. **Şifre kuralı:** ✅ **en az 8 karakter kalır** (sunucunun kuralı; prototipin 10+ karakter,
    büyük/küçük harf, rakam, simge kuralı alınmadı).
16. **`0011` öncesi hesaplar:** ✅ **bütün yerel hesaplar işaretlenir** (`0011` içinde
    `UPDATE users SET must_change_password = true WHERE auth_source = 'local'`; AD hesapları asla;
    geri alma sütunu siler). Yerel hesabı olan herkes güncellemeden sonraki ilk girişte bir kez
    şifresini değiştirir — deploy'dan önce duyurulur (G1-15 deploy kapısı).
17. **Kilit açılınca nereye dönülür (07.10.2026):** ✅ **bıraktığı ekrana** — tek istisna hasta
    sayfası, oradan kilitlenmişse ana ekrana dönülür. Kilitli ekranı başka biri de uyandırabilir;
    bir hastanın adını taşıyan sayfa sorulmadan yeniden açılmaz. Oturum biterse, başka bir hesap
    girerse ya da oturum geçersiz kılınırsa hatırlanan ekran düşer; yer imiyle açılan derin
    adres girişten sonra bir kez kullanılır (`shell/routes.js` `resumePath`, `LiveApp.jsx`).

---

## Grup 1 · iş listesi

Puan ≈ yarım gün/3 puan. Toplam **82 puan ≈ 11–13 iş günü** (alt ajanlı yürütme, inceleme dahil).
Her dalganın ayrıntılı planı, bir önceki dalga bitince birleşmiş koda bakılarak yazılır.
Çalışma yeri: `feat/ldap-rbac`'tan açılan `feat/canli-tasarim` dalı, ayrı worktree
(`C:/tmp/homunculus-g1`) — ana ağaçtaki commit'lenmemiş `main.jsx`/`vite.config.js` düzenlemelerine
dokunulmaz.

| # | İş | Puan | Risk | Bağımlı | Durum |
|---|---|---|---|---|---|
| G1-01 | nginx: eksik API yolları + yapılandırma testi | 1 | Düşük | — | ✅ 01.10 · a638151 |
| G1-02 | main → LDAP birleştirme: 9 çakışma, göç `0010`, `clinical.chart` + `scores.sign` izinleri, kapsam izinlere, `infinity_research` `devices.manage`, demo kabuğu LDAP sürümü; bütün testler yeşil · plan: [dalga 0](2026-10-01-g1-dalga0-main-ldap-birlestirme.md) | 13 | **Yüksek** | G1-01 | ✅ 02.10 · 61d257a…c094b64 |
| G1-03 | LDAP arka ucu · dizin modülü + AD girişi + yenilemede dizin kontrolü (spec §7, §4) · plan: [dalga 1A](2026-10-03-g1-dalga1a-ldap-arka-uc.md) | 5 | Orta | G1-02 | ✅ 03.10 · 14b6750…20d7409, inceleme düzeltmeleri F1–F2 08ee940…dabd690 |
| G1-04 | LDAP arka ucu · `/admin/ldap/*` içe aktarma, grup eşlemesi, yerel yönetici koruması (zaten Plan 1'de: `count_admins` yalnız yerel yöneticileri sayar) · plan: [dalga 1A](2026-10-03-g1-dalga1a-ldap-arka-uc.md) | 5 | Orta | G1-03 | ✅ 04.10 · a551711…a8c4b81, inceleme düzeltmeleri F3–F5 4cdc8aa…a941bd9, gerçek dizin testi + belgeler 1fc6457… |
| G1-05 | Tasarım temeli: Gece/Gün renk değişkenleri, fontlar (yerel paket), ikonlar, temel bileşenler — `dashboard/src/live/` · plan: [dalga 1B](2026-10-03-g1-dalga1b-tasarim-temeli.md) | 5 | Düşük | G1-02 | ✅ 03.10 · 9d130be…bec4d7d (`dashboard/src/live`; cila dahil, Dalga 1A commit'leri arada) |
| G1-06 | Dört dil çatısı (anahtarlı sözlük, D2 varsayılanı) · plan: [dalga 1B](2026-10-03-g1-dalga1b-tasarim-temeli.md) | 3 | Düşük | G1-05 | ✅ 03.10 · 9d130be…bec4d7d (`dashboard/src/live`; cila dahil, Dalga 1A commit'leri arada) |
| G1-07 | Kabuk: sol menü (izinle), üst çubuk (birim çipi, saat, nöbet bitimine, dil, tema, zil, kişi menüsü); canlı mod yeni kabuğa · plan: [dalga 2](2026-10-04-g1-dalga2-kabuk-giris.md) (nöbet bitimine gösterilmiyor: karar 12) | 5 | Orta | G1-05, G1-06 | ✅ 07.10 · a60de51…7cdee86 |
| G1-08 | Giriş + 2FA + (D4'e göre) ilk girişte şifre, kilit ekranı · plan: [dalga 2](2026-10-04-g1-dalga2-kabuk-giris.md) (göç `0011` bütün yerel hesapları işaretler, `POST /auth/reauth`) | 5 | Orta | G1-07 | ✅ 07.10 · a60de51…7cdee86 |
| G1-09 | Yataklar: kart/liste, risk sırası, dikkat kartları, birim filtresi, kapsam açıklaması | 5 | Orta | G1-07 | Bekliyor |
| G1-10 | Alarmlar: yanıt bekliyor / değerlendiriliyor / kapanan, Gördüm, eskalasyon hapları, sunucu saatiyle süre | 3 | Düşük | G1-07 | Bekliyor |
| G1-11 | Hasta ekranı · Özet: başlık, vital çubuğu, öneri kartı (gerekçe + kaynak), salt okunur | 5 | Orta | G1-09 | Bekliyor |
| G1-12 | Yönetim · Kullanıcılar (D3) + birimler (kapsam matrisi) · plan: [dalga 3B](2026-10-12-g1-dalga3b-yonetim-ekranlari.md) | 5 | Orta | G1-07 | ✅ 13.10 · temel (Görev 0–4) 5fdc5cd…34494a8; Görev 5–7 b10179d, 6bc6740, 95adfa6, inceleme turları 9f49cb3 + baa1780; Görev 14 fa8c522 (`/scope/me` panoyla aynı karar) + 65d6a36 (14e). Kapsam "matrisi" liste olarak (Karar 7, aşağıda kabul ölçütleri). Tarayıcıda 390/1440 px bakışı kullanıcıda |
| G1-13 | Yönetim · Roller ve yetkiler (grup × izin matrisi) · plan: [dalga 3B](2026-10-12-g1-dalga3b-yonetim-ekranlari.md) | 3 | Düşük | G1-12 | ✅ 13.10 · Görev 8–9 05c7e7a, 1eb7356, inceleme turları fedde5b + 2ab1f10; 409 yolunu canlı yapan sunucu karşılaştırması Görev 14e 65d6a36. Tarayıcıda bakış kullanıcıda |
| G1-14 | Yönetim · Sistem ayarları › Giriş kaynağı (AD durumu, bağlantı testi, ara + içe aktar, grup eşlemesi) · plan: [dalga 3B](2026-10-12-g1-dalga3b-yonetim-ekranlari.md) | 5 | Orta | G1-04, G1-12 | ✅ 13.10 (kod ve testler) · Görev 10–11 a6de6b2, 96c37ee, inceleme turları 6e8f6c9, 5fd309d, a06fc3c. Bağlantı testinin beş gerçek nedeni hastanenin etki alanı denetleyicisi olmadan denenemez (yalnız taklitle test edildi) → G1-15 kapısı |
| G1-16 | Demo ve eski modları kaldır (`ClinicalDemo.jsx`, `clinicalDemo.js`, `liveStore.js`, `clinicalI18n.js`, `legacyRoots.jsx`, replay, legacy board, `?eski=1` önceki canlı arayüz — kilidi bilmez, G1-15'ten önce gitmeli); PWA `?demo` başlangıcı Dalga 2'de düzeltildi | 3 | Orta | G1-09…G1-14 | Bekliyor |
| G1-15 | Uçtan uca doğrulama (yerel yığın, 4 dil, 390 px/1440 px) + VM deploy notları · temel: [RBAC planı](2026-09-23-rbac-groups-permissions.md), "Deploy notes for the VM" (zorunlu MFA kaydı: Sistem Yöneticisi, Sorumlu Hekim, Ünite Hekimi, Üretici Destek ilk girişte TOTP kurar; `0010` ön kontrolü) | 3 | Orta | hepsi | Bekliyor |

Dalga 0 sonu: backend 1665 geçti / 1 atlandı / 0 hata; dashboard 810 geçti (43 dosya); vite build tamam.
Kapanış düzeltmeleriyle (`f5abde8` test hesabı tohumu, `1e7b11b` iki metin): backend 1670 geçti /
1 atlandı / 0 hata; dashboard 810 geçti (43 dosya).

Dalga 1A sonu (G1-03/G1-04, son kod commit'i `8eb6b1d`; sonrası yalnız belge): backend 2101 geçti /
6 atlandı (eski 1 + gerçek dizin testinin 5'i, `LDAP_TEST_*` yok) / 0 hata, test veritabanıyla;
dashboard 1316 geçti (63 dosya); vite build tamam; nginx `-t` (nginx:alpine) tamam;
`docker compose --env-file deploy/local/.env.example config` tamam (örnek dosyada boş bırakılan
dört zorunlu sır yer tutucuyla verildi).

Dalga 2 sonu (G1-07/G1-08, son kod commit'i `7cdee86`; sonrası yalnız belge): backend 2289 geçti /
6 atlandı / 0 hata (Python 3.14, test veritabanıyla) ve üretim imajının Python 3.12'siyle 2285
geçti / 8 atlandı / 0 hata; dashboard 1741 geçti (86 dosya) — bunun 851'i yeni arayüzün
(`src/live/`, 41 dosya); vite build tamam.

Dalga 3B sonu (G1-12/G1-13/G1-14, son kod commit'i `65d6a36`): dashboard 2413 geçti (108 dosya);
vite build tamam; backend Python 3.12'de 2294 geçti / 8 atlandı, 3.14'te 2298 geçti / 6 atlandı —
ikisinde de `tests/test_infinity_vm_pilot.py` hariç: yük altında asılı kalıyor (tek başına 8 s'de
geçiyor), düzeltmesi Grup 4. Her sekme iki ya da üç kez incelendi; her bulgu düzeltilmeden önce
başarısız bir testle kanıtlandı ve incelemecilerin mutantlarını testler yakaladı. Tarayıcıda
bakış (390/1440 px, iki tema) **yapılmadı**: kullanıcının işi, aşağıda "Dalga 3B'den açık kalanlar".

> G1-15'teki VM deploy kullanıcının kararıdır (aşağıda "Kullanıcı kararları", 2–3):
> yedek → `0010` ön kontrolü → göç `0008 → 0009 → 0010` → herkes bir kez yeniden girer.

**G1-15 deploy kapısı — AD açılmadan önce (F7):**

- VM'de salt okunur gerçek dizin denetimi `tests/test_ldap_integration.py` **5 geçti**
  (runbook, "Check against the real directory") — `LDAP_URL` üretim `.env`'ine ancak bundan
  sonra girer.
- Dizin `GET /admin/ldap/status` ile doğrulandı: `configured: true`, `last_test_ok: true`
  (günlükteki "succeeded" satırı ikinci işaret).
- VM'nin saati etki alanı denetleyicisiyle eşzamanlı (runbook, "Clock"; `pwdLastSet` ve
  `accountExpires` VM saatiyle karşılaştırılır).
- AD açılmadan önce TOTP'si kurulmuş **en az 2 yerel `hospital_admin`** hesabı var (AD kesintisi
  ya da eşleme hatası Homunculus'un içinden onarılabilsin).
- VM `.env`'inde `LDAP_ALLOW_INSECURE` **yok** (üretimde artık LDAP'ı kapalı tutar ve her
  açılışta ERROR yazar).
- Arka uç test takımı inşa edilmiş API imajının **içinde** koşuldu (Python 3.12 +
  `constraints.txt`, üretimdeki paket seti).
- Karar 11 (aşağıda, F7 ekleriyle: AD hesaplarının 503'le ayırt edilmesi, bir klinisyenin
  girişinin 429'da tutulabilmesi) kullanıcı tarafından verildi.
- Deploy, son 15 dakikada hatalı AD girişi yokken yapılır: yeniden başlatma Homunculus'un
  dizilerini siler, AD'nin sayacını silmez (runbook, "A slow run is bounded too"). Yeniden
  başlatma öncesi sorgusu `login.fail` **ve** `reauth.fail` satırlarını birlikte okur (kilit
  ekranındaki hatalı denemeler de AD'nin sayacına işler), ama yalnızca AD'ye özgü gerekçeleri
  sayar — `directory_unavailable`, `cancelled`, `directory_error`. `bad_credentials` listede
  **değil**: yerel bir hesabın hatalı şifresi de bu gerekçeyi yazıyor ve AD'ye hiç gitmiyor, yani
  yerel satırlar "son 15 dakikada AD'ye bind gitti mi?" sorusunun yanlış pozitifleriydi (runbook,
  "Before restarting the API").
- **(Dalga 2 incelemesi)** Tabletlerde ana ekrana eklenmiş uygulama **yeniden eklenir ya da yeniden
  kurulur.** PWA manifestinin `start_url`'ü Dalga 2'de `/?demo=1`'den `/`'ye çekildi, ama kurulu
  bir kısayol tarayıcı manifesti yeniden okuyana kadar eski adresi açmaya devam eder — yani
  simülasyonu. `?demo=1` G1-16'da silindiğinde o kısayol hiçbir şey açmaz (artık boş sayfa değil,
  "sayfa yüklenemedi" der — `src/LoadFailed.jsx`). Deploy'dan sonra her tablet tek tek gözden
  geçirilir.
- **(Dalga 2 incelemesi)** VM'nin kendi nginx yapılandırmasında `location = /auth/reauth` ve
  `location = /auth/password` tam eşleşmeleri ile `homunculus_reauth` bölgesi **var mı** diye
  bakılır (`deploy/local/web/nginx.conf` ile karşılaştır). Yoksa istekler yine de vekillenir —
  önek bloğu yakalar — ama sınırsız ve JSON 429'suz: kilit açma ile şifre değiştirmede hız sınırı
  olmaz. Tek satırlık kontrol, deploy'dan önce.
- **(Dalga 2)** `?eski=1` (önceki canlı arayüz) G1-16 ile kaldırıldı: kilit ekranını bilmez, kilitli
  bir tarayıcıda açık oturumu gösterir.
- **(Dalga 2)** Mobil uygulama: geçici şifreli hesap girişte "önce panodan şifrenizi belirleyin"
  der (Dalga 2, Görev 3). Cihazlarda bu sürümden eski bir uygulama varsa, işaretli hesap orada her
  istekte çıplak 403 alır — deploy'dan önce güncellenir ya da kullanıcılar şifrelerini önce
  panoda değiştirir.
- **(Dalga 2)** Göç `0011` bütün yerel hesapları işaretler (karar 16): kullanıcılara deploy'dan
  önce duyurulur — yerel hesabı olan herkes (tohum yönetici dahil) ilk girişte bugünkü şifresiyle
  girip yenisini belirler; AD hesapları etkilenmez. İlk vardiya, aynı adresin arkasındaki bir
  serviste nginx'in `homunculus_reauth` bölgesini (dakikada 30, burst 30) şifre değişiklikleri ve
  kilit açmalarla paylaşır: bir dakika bekleyip yeniden denemek gerekebilir (runbook, "Updating").
- **(Dalga 3B)** Azerbaycanca konuşan bir yönetici aşağıdaki beş metni okur ve her birinin yazıldığı
  gibi anlaşıldığını onaylar. Planın seçtiği beş metin (`admin.sub` dışındakiler dalganın en uzun
  cümleleri); dört dil makineyle yazıldı. Klinik metin
  değiller, ama `source.skipInvalidLogin` yöneticinin **uygulayacağı** bir harf çevirme kuralı
  taşıyor: Azerbaycancası kötüyse yanlış uygular.
- **(Dalga 3B)** Yönetimin üç sekmesi VM'nin kendi verisiyle **390 px'te** açılır: hastanenin
  yöneticileri masada tablet kullanıyor.
- **(Dalga 3B)** Giriş kaynağındaki bağlantı testi hastanenin gerçek etki alanı denetleyicisine
  karşı koşulur ve yanıtı kaydedilir. Testin beş ret nedeni (ulaşılamıyor, süre aşımı, TLS, servis
  hesabı reddedildi, protokol) bu dalganın denetleyici olmadan sınanamayan tek parçası: yalnız
  taklitle test edildi. AD'nin VM'de açılması hâlâ BT biriminin yanıtlarını bekliyor
  (`docs/active-directory-bt-sorulari.md`) ve yukarıdaki F7 maddelerine bağlı.

**G1-15 okuması · Dalga 3B'nin beş metni** — ekranda görünen hâlleri, `65d6a36`'da
`dashboard/src/live/i18n/strings/` altındaki `admin.js`, `roles.js`, `source.js`'ten olduğu gibi
alındı (Dalga 3B Görev 12 Adım 6'nın kaydı; o adım yazılmamıştı, burada yapıldı). `{hospital}`
ekranda hastanenin adıyla doldurulur.

- `admin.sub` (Yönetim sayfasının alt başlığı)
  - az: {hospital} · hər dəyişiklik audit jurnalına yazılır
  - tr: {hospital} · her değişiklik denetim kaydına yazılır
  - ru: {hospital} · каждое изменение пишется в журнал аудита
  - en: {hospital} · every change is written to the audit trail
- `roles.note` (Roller ve yetkiler tablosunun altındaki not)
  - az: Səlahiyyət yoxlanışı serverdə aparılır: bu cədvəl nəyin verildiyini göstərir, nəyin görünəcəyini deyil. Menyudan gizlətmək səlahiyyəti götürmək deyil.
  - tr: Yetki denetimi sunucuda yapılır: bu tablo neyin verildiğini gösterir, neyin görüneceğini değil. Menüden gizlemek yetki kaldırmak değildir.
  - ru: Проверка прав выполняется на сервере: эта таблица показывает, что выдано, а не что будет видно. Спрятать в меню — не значит снять право.
  - en: Permissions are checked on the server: this table shows what has been granted, not what will be visible. Hiding something in a menu is not taking a permission away.
- `source.notConfigured` (dizin yapılandırılmamışken Giriş kaynağı sekmesinin Durum kutusundaki not; sekme o zaman başka bölüm çizmez)
  - az: Kataloq konfiqurasiya olunmayıb. Korporativ hesabla giriş bağlıdır; yalnız lokal hesablar istifadə olunur. Bu, server konfiqurasiyasıdır (LDAP_URL) və buradan dəyişdirilə bilməz.
  - tr: Dizin yapılandırılmamış. Kurumsal hesapla giriş kapalı; yalnız yerel hesaplar kullanılıyor. Bu, sunucu yapılandırmasıdır (LDAP_URL) ve buradan değiştirilemez.
  - ru: Каталог не настроен. Вход с корпоративной записью отключён; используются только локальные записи. Это настройка сервера (LDAP_URL), и отсюда её изменить нельзя.
  - en: The directory is not configured. Signing in with a corporate account is off; only local accounts are in use. This is server configuration (LDAP_URL) and cannot be changed here.
- `source.skipInvalidLogin` (içe aktarmada atlanan bir hesabın nedeni)
  - az: istifadəçi adı lokal qaydaya uyğun deyil (a-z, 0-9 və . _ @ -); AD-dəki sAMAccountName-i Latın qarşılığı ilə yazın: ş→s, ç→c, ğ→g, ö→o, ü→u, ı→i, ə→e
  - tr: kullanıcı adı yerel kurala uymuyor (a-z, 0-9 ve . _ @ -); AD'deki sAMAccountName'i Latin karşılığıyla yazın: ş→s, ç→c, ğ→g, ö→o, ü→u, ı→i, ə→e
  - ru: логин не соответствует местному правилу (a-z, 0-9 и . _ @ -); запишите sAMAccountName латиницей: ş→s, ç→c, ğ→g, ö→o, ü→u, ı→i, ə→e
  - en: the username does not match the local rule (a-z, 0-9 and . _ @ -); write the sAMAccountName in its Latin form: ş→s, ç→c, ğ→g, ö→o, ü→u, ı→i, ə→e
- `source.mapPickHint` (AD grup eşlemesinde grup arama alanının ipucu; yalnız eşlemeyi değiştirebilen yöneticiye görünür)
  - az: Ən azı 2 simvol. Fərqləndirici ad (DN) siyahıdan seçilir, əl ilə yazılmır: əl ilə yazılan DN-in Türk/Azərbaycan hərfləri AD-dəki yazılışdan fərqlənərsə uyğunlaşma səssizcə işləməz.
  - tr: En az 2 karakter. Ayırt edici ad (DN) listeden seçilir, elle yazılmaz: elle yazılan bir DN'in Türkçe/Azerbaycanca harfleri AD'deki yazımdan farklı olursa eşleşme sessizce çalışmaz.
  - ru: Не менее 2 знаков. Отличительное имя (DN) выбирается из списка, а не вводится: у введённого вручную DN турецкие и азербайджанские буквы могут отличаться от написания в AD, и сопоставление молча не сработает.
  - en: At least 2 characters. The distinguished name (DN) is chosen from the list, never typed: a typed DN whose Turkish or Azerbaijani letters differ from AD's spelling will silently fail to match.

### Dalgalar

| Dalga | İşler | Paralel mi |
|---|---|---|
| 0 | G1-01 → G1-02 | Sıralı (her şey buna dayanır) |
| 1 | G1-03 → G1-04 ‖ G1-05 → G1-06 | İki kol paralel (arka uç / ön yüz) |
| 2 | G1-07 → G1-08 | Sıralı |
| 3 | G1-09 → G1-11 ‖ G1-10 ‖ G1-12 → G1-13 | Üç kol paralel |
| 4 | G1-14 → G1-16 → G1-15 | Sıralı |

### Hastaneden gerekenler (G1-03'ü bekletmez, G1-15'i bekletir)

1. LDAPS adresi (`ldaps://…:636`, etki alanı denetleyicisinin sertifikadaki DNS adıyla, IP
   değil) ve CA sertifikası
2. Salt okunur servis hesabı (bind DN + şifre); `pwdLastSet`, `accountExpires`, `memberOf`
   okuyabilmeli (okuyamazsa parola değişikliği/süre sonu sessizce görülmez)
3. Arama kökü (base DN): kullanıcıları VE eşlenecek grupları kapsamalı
4. Rol karşılığı AD grupları (ör. YB-Hekim, YB-Hemşire)
5. VM'den etki alanı denetleyicisine 636 portu açık mı
6. Servis PC'leri tek bir NAT/terminal sunucusu arkasında mı? (nginx giriş sınırı IP başına
   10/dk + 10 patlama; ortak IP'de vardiya değişiminde 429 olabilir)
7. Etki alanı hesap kilitleme politikası (eşik ve sıfırlama süresi) — eşik en az 7 olmalı
   (3 + 3'ün üstünde; AD hesabı eşiğe ulaşan denemede kilitler, 6'da 6. deneme kilitlerdi):
   Homunculus hesap başına bir hatalı deneme dizisinde (son hatadan sonra 15 dk hatasız
   geçince biter) en çok 3 hatalı bağlanma yapar, yöneticinin kilit açması (dizi başına bir
   kez) 3 tane daha getirir: 3 + 3. Sıfırlama süresi en çok 15 dk olmalı (daha uzunsa AD
   önceki diziyi sayarken yenisi başlar); 15 dakikanın kesinlikle altında olması tercih
   edilir (saatler için pay kalır). (Önceki metin "en az 6" diyordu; `auth/limits.py`
   "eşik bunun üstünde kalmalı" der.)
8. Etki alanındaki sAMAccountName'ler ASCII mi? (ş/ç/ğ/ö/ü içeren adlar `invalid_login` ile
   içe aktarılamaz)
9. Adında `#` veya `=` geçen AD grupları var mı? (ldap3'ün DN çözümleyicisi kaçışsız `#`/`=`
   kabul etmez; eşleme 422 verir)
10. Etki alanında birden çok denetleyici varsa: bir DC'de başarılı oturum açma, PDC
    öykünücüsünün o hesap için tuttuğu hatalı parola sayacını sıfırlıyor mu? Homunculus hatalı
    deneme dizisini başarılı girişte bitiriyor; sayaç sıfırlanmıyorsa bu iyimser kalır ve
    sınırın yeniden düşünülmesi gerekir (F7).

## Grup 1 kabul ölçütleri (Dalga 0 incelemesinden)

**G1-09 Yataklar**

- Motorun `risk` değerleri açıkça eşlenir: `moderate` amber; `none`/`info` nötr
  ("bulgu yok / ölçülmedi"; `info` bir alarmdır, hep "Bilgi"). Hiçbiri yeşil "stabil"e düşmez.
- Kart `RiskPill`'e `measured`'ı açıkça geçirir (kartın zaman damgalarından).
  Geçirmezse `none` "ölçülmedi" okunur, "bulgu yok" değil.
- Renk şeridi/noktası hiçbir zaman tek ipucu değildir: yanında ikon ya da metin olur.
  Gün'de `--mid`, `--high`, `--ok` dolgularının parlaklığı neredeyse aynı (1,01–1,04:1).
- NEWS2 `red_param` kartı en az amber yapar. Motorla çatışıyor → aşağıda
  "Kullanıcı kararları", 9.
- Açık alarm kartın üstünde görünür.
- Bağlantı durumu (DEGRADED/UNAVAILABLE) ekranda bir şeritle görünür;
  boş pano "sakin servis" gibi görünmez.
- Besleme sağlığı çipi ("N yatak sessiz").
- Motorun kapsam notu görünür.

**G1-10 Alarmlar**

- Alarm bandı `<body>`'nin doğrudan çocuğudur ve `MODAL_EXEMPT` taşır: açık bir pencere
  `#root`'u `inert` yapar ve `inert` içindeki canlı bölge (live region) susar.

**G1-11 Hasta özeti**

- Her vitalin yaşı/bayatlığı görünür.
- NEWS2 eski vitallerle "tam" görünmez. Motor tarafı da var: `api/board.py`
  `news2.score()`'u tazelik uygulamadan çağırıyor → Grup 2 motor işi
  (aşağıda "Dalga 0'dan açık kalanlar").

**G1-12 Kullanıcılar + birimler**

- `/scope/me` panoyla aynı kararı verir: `enforce_unassigned` ve break-glass dahil.
  ✅ **Karşılandı, Dalga 3B Görev 14 (`fa8c522`).** `scope/router._view` artık ikisini de panonun
  kendi çözücüsü gibi `build_scope`'a geçiriyor; rolü None olan kullanıcı (etkin hesabı ya da bu
  kurumda etkin üyeliği yok — örneğin pasifleştirilmiş bir hesap, yönetici rotası eskiden onu
  "sınırsız" diye bildiriyordu) çözücünün UNKNOWN'ı olur ve hiçbir şey görmez.
  `tests/test_scope_me_agrees_with_board.py` iki tarafı dört kapsam nedeninde (rol, atanmış,
  atanmamış, break-glass) ve UNKNOWN'da birbirine bağlar. `SCOPE_ENFORCE_UNASSIGNED` açıkken
  ataması olmayan bir hemşire için yanıt artık "sınırsız" değil: yalnız kendi hastalarını (bakım
  ekibi ve acil erişim) görür. `ScopeView.own_patients` bu hastaların **sayısıdır**, kimlikleri değil.
- Kapsam "matrisi" (birim × yatak): **liste olarak karşılandı**, Dalga 3B planının Karar 7'siyle.
  Bir kapsamın adlandırabileceği birimleri ve yatakları listeleyen bir uç yok (yatak eşleme
  dosyasının anahtarlarıdır; `/tenant/*` ağacı `structure.manage` ister ve kimlikleri o dosyaya
  bağlı değil). Düzenleyicinin seçenekleri panodaki kartlardan, kullanıcının mevcut atamalarından
  ve elle yazılan bir anahtardan gelir; ekran bunu ve boş bir birimin listede görünmediğini söyler.

---

## Bu dal VM'ye çıkmaz (G1-15'e kadar)

VM bugün main'i değil `origin/feat/infinity-production-integration`'ı (`538ba54`) çalıştırıyor:
sunucu taraflı kapsam yok, göçler `0008`'de. Bu daldan deploy, göçleri `0008 → 0009 → 0010`
yolundan yürütür.

Birleşmiş dalın canlı arayüzü LDAP `ClinicalDemo`'dur. VM'deki derlemeye göre aşağıdaki modüller
kodda tutuldu ama bu arayüze bağlı değil; dal bu hâliyle VM'ye çıkarsa klinisyen bugün kullandığı
ekranları kaybeder. Bu yüzden G1-15'ten (yeni kabuk) önce VM'ye deploy edilmez.

**G1-15 de hepsini geri getirmez.** G1-15 deploy'u, hedefi Grup 2–4 olan şu yetenekleri de
VM'den kaldırır:

- elle vazopressör/sıvı girişi (septik şok kuralı ve SOFA kardiyovasküler bileşeni bunları kullanır)
- hasta normali (bazal değerler)
- kabulde kilo/komorbidite profili
- besleme sağlığı
- duvar monitörü, RRT, ısı haritası
- alarm kalitesi, denetim bütünlüğü
- biyomedikal araştırma penceresi

Bu yüzden G1-15 öncesi kullanıcı kararı gerekir (aşağıda "Kullanıcı kararları", 2).

Tutulup bağlanmamış modüller → hedef:

- SOFA şiddet formu doldur/imzala (`severityScore.jsx`; `scores.sign` yoksa "İmzala" gizli) → G1-11
- Şüpheli enfeksiyon ve bazal SOFA girişi (`setSuspectedInfection`/`setProfile`; bunlar olmadan sepsis kuralı hiç çalışmaz) → G1-11
- Alarm kalitesi paneli (`AlarmQualityPanel`, `clinicalAdmin.jsx`) → Grup 4
- Denetim bütünlüğü + motor denetim sayfası (`refreshAudit`/`verifyAudit`) → Grup 2
- InfinityBeds + cihaz sağlığı (`feedHealth`) → Grup 4
- Duvar monitörü + ad maskeleme politikası (`wallBoard.jsx`, `policySettings`) → Grup 2
- Arayüzde build SHA (`__BUILD_SHA__`) → G1-07 ✅ hesap menüsü ve Ayarlar › Profil.
- Motorun kapsam notu (`engineScope`/`scopeNote`) → G1-09
- RRT kuyruğu (`rrtQueue`) → Grup 2
- Isı haritası (`alarmDensity`) → Grup 2
- Hasta etiketi (`patientLabel`) → G1-09
- `patientScope.js` ekran kapsamı (rol yerine izin modeline uyarlanmalı) → G1-12

## Main'den gelen ve yeni kabukta karşılanacak davranışlar

Birleştirmede (G1-02) main'in `ClinicalDemo.jsx` yeniden yazımı alınmadı (D1); o ekranları
render eden 12 test dosyası silindi. Her satır, silinen bir testin koruduğu davranıştır ve
etiketlenen işin kabul ölçütüdür. Aynı birleştirmede canlı store'un simülasyona yazan
üzerine-yazmaları (`admitPatient`, `addMedication`, `addFluid`, `assignStaffToBeds`,
`toggleStaffBed`) da kaldırıldı — LDAP dalının kuralı: canlıda simülasyon eylemi
`LIVE_UNAVAILABLE` ile reddedilir; bunların testleri de aşağıda. Silinen dosyalardaki saf
adaptör sözleşmeleri (yaş, HBYS cinsiyet/tanıları, motorun NEWS2'si, ilaç bloğu, HBYS'den bekleyen
hasta) silinmedi, `dashboard/src/liveAdapters.test.js`'e; dil algılama vakaları
`i18n.rbac.test.js`'e taşındı.

- admissionFromHis · HBYS'nin kabul edip burada yatağa alınmamış hastası kabul ekranında "HBYS'den bekleyen" olarak sunulur, ad/doğum tarihi/cinsiyet/tanı yeniden yazdırılmaz; HBYS beslemesi yoksa panel hiç çizilmez. → Grup 2
- admissionScreen · Hasta Kabul menüden açılır; Kabul / Transfer / Bakım ekibi sekmeleri vardır, bakım ekibi ayrı menü maddesi değildir. → Grup 2
- admissionScreen · Daraltılmış sol menüde her madde kısa adıyla görünür, yalnız ikon kalmaz. → G1-07 ✅ `shell/Sidebar.jsx` (`nav.*Short`), `Shell.test.jsx`.
- admissionScreen · Kabul formu yaşı doğum tarihinden hesaplar ve elle değiştirtmez; zorunlu alan eksikken düğme kapalıdır ve eksiği adıyla söyler. → Grup 2
- admissionScreen · Kabul onaylanınca doğum tarihi kayda düşer, protokol numarası ve yazdırılabilir barkodlu etiket çıkar; onaydan önce barkod uydurulmaz. → Grup 2
- biomedicalAccess · "Cihaz & Veri Akışı" sayfasına biyomedikal ve hastane yöneticisi ulaşır, hekim ve hemşire ulaşmaz; yalnız `devices.manage` taşıyan kullanıcı bugün canlı arayüze hiç giremiyor (`NO_BOARD_ACCESS`), sayfa gelince giriş kuralı da değişmeli. → Grup 4
- biomedicalAccess · Cihaz sayfası önce "veri geliyor mu" sorusunu yanıtlar (sessiz yatak, bayat kanal, veri akışı), sonra cihaz envanterini gösterir. → Grup 4
- escalationClock · Canlıda alarm ve eskalasyon süresi gerçek zamanla ilerler; simülasyonun 60× hızı uygulanmaz. → G1-10
- escalationClock · Süre biçimi: bir saatin altında `d:ss`, üstünde `s:dd:ss` (318:30 yazılmaz), negatif süre `0:00`. → G1-10
- loginRemember · "Beni hatırla" yalnız kullanıcı adını/e-postayı saklar, şifre ya da PIN'i asla; işaret kaldırılınca silinir; hatırlanan ad oturum açmaz, giriş ekranı yine gelir. → G1-08 ✅ `session/browserState.js`, `sessionStore.test.js`, `SignIn.test.jsx`.
- news2Honesty, news2Source · Kartta tek NEWS2 vardır, motorunki: motor göndermezse sayı yerine "—" ve nedeni (motor göndermedi) görünür; tarayıcı kendi NEWS2'sini (OAB'li yerel hesap) canlıda hiç göstermez. → G1-09
- news2Honesty · Eksik vitalle hesaplanmış kısmi NEWS2 kartta işaretlenir (kısmi skor yalnız düşük gösterebilir). → G1-09
- patientBaseline · Hastaya özel alarm aralığı motora gider (`PUT /clinical/{id}/profile` · `baselines`); girilmeyen parametre gönderilmez (boş ≠ sıfır), ters aralık gönderilmeden reddedilir, kutu bunun cihaz alarmı olmadığını söyler. → Grup 2
- pharmacyView · Eczacının kendi sayfası vardır (antibiyotik saati, doz önermez, "kayıt yok"u "verilmedi" diye göstermez); eczacı ve sorumlu hekim görür, hemşire görmez. → Grup 3
- rrtPage · RRT ekranı menüdedir: hızlı yanıt ekibi ve yönetici görür, hemşire görmez. → Grup 2
- rrtPage · RRT ekranı kendisine eskale edilen alarmları (elle çağrıldıysa yazılı) ve yoldaki cevapsız alarmları ayrı gösterir; liste boşsa boş durumu, 3. kademe kapalıysa bunu açıkça yazar. → Grup 2
- rrtPage · Menü rozeti cevapsız eskalasyon sayısını gösterir; cevaplanan alarm rozetten düşer. → Grup 2
- setupWizardScope · Canlı kurulumda yönetici kurulum sihirbazına düşmez (kiracı deploy'da kurulur), doğrudan ürüne, Sistem Ayarları'na ve cihaz sayfasına ulaşır; diğer roller de doğrudan girer. → G1-07 ✅ sihirbaz yok; herkes kendi ana ekranına düşer (`shell/routes.js` `homePath`; Dalga 2'de Ayarlar), `LiveApp.test.jsx`. Sistem Ayarları ve cihaz sayfası G1-14 / Grup 4.
- simulationGating · Canlıda simülasyon denetimleri (alarm üret, saat hızı 30×/60×/120×, duraklat, "sonuç simüle et", DEMO etiketi) hiç çizilmez; mod belirtilmezse varsayılan canlıdır. → G1-16
- simulationGating · Break-glass canlıda kalır: araç değil, gerçek klinik denetim. → Grup 2
- simulationGating · Canlı Sonuçlar sayfası gerçek bekleyen sayısını ve elle yüklemeyi korur. → Grup 3
- simulationGating · Dil algılama bugün İngilizce yerel ayarda TR, Azerbaycanca cihazda AZ açar, seçilen dil kazanır (testleri `i18n.rbac.test.js`'te); D2 ile varsayılan AZ olunca bu testler birlikte değişir. → G1-06 ✅ Yeni kabukta `src/live/i18n/I18nProvider.test.jsx` (AZ varsayılan, algılama yok, saklanan seçim kazanır); `i18n.rbac.test.js`'teki eski vakalar eski çalışma alanını G1-16'ya kadar korur.
- clinicalCharting (silinen vakalar) · Vazopressör/inotrop dozu (noradrenalin, adrenalin, dopamin, dobutamin; yazım farkı önemsiz) motora hız kodu olarak gider; puanlanmayan ilaç sinyal diye uydurulmaz. → Grup 3
- clinicalCharting (silinen vakalar) · Verilen sıvı (yalnız giriş) motora `crystalloid_bolus_ml` olarak gider; çıkış gönderilmez. → Grup 3
- clinicalCharting (silinen vakalar) · Kabulde kilo `weight_kg` gözlemi, serbest metin eşlik eden hastalıklar ("DM, HT; KOAH") hasta profili olarak motora gider; boş kutu profil göndermez, yan kanal hatası kabulü geri almaz. → Grup 2
- scopeAssignment (silinen vakalar) · Kapsam matrisi (birim + yatak) `PUT /scope/{user}` ile motora yazılır, tek hücre tıklaması da aynı yoldan gider; motor reddederse ekrandaki matris geri alınır. → G1-12 ✅ Dalga 3B: matris değil liste (Karar 7, yukarıda kabul ölçütleri); kayıt bütün listeyi `PUT /scope/{user}` ile tek seferde yazar; motor reddederse ekrandaki liste geri alınır ve bunu söyler; yanıt gelmezse (süre aşımı, kopan bağlantı) geri alınmaz, kapsam yeniden okunur — yazma gitmiş olabilir. Kaydet yalnız kapsamı **rolü gereği** sınırsız olan yöneticiye çizilir (`users.manage` yetmez; sunucunun kuralı).

## Dalga 0'dan açık kalanlar

- Infinity araştırma ucu (`/infinity-research/state`) hastaneye bağlı değil: tek hastaneli pilotta sorun yok; bir API birden çok hastaneye hizmet edecekse önce kiracıya bağlanmalı. `devices.manage` platform_support grubunda da var. → Grup 4
- `/infinity-research/state` `caller_tenant_id` kullanmıyor: pasif üyelik ancak sonraki token sürümünde yakalanır. → Grup 4
- Denetim kaydında kişi kimliği artık kullanıcı adı (main'de JWT `sub` = UUID'ydi); aynı zincirde iki biçim olacak. → G1-15 deploy notu
- Kapsam denetim satırları yöneticiyi UUID ile, klinik satırlar kullanıcı adıyla yazıyor. → G1-15 deploy notu
- SSE bileti kapsamı bağlantı boyunca sabit; kapsamlı abonelere `removed` karesi gitmiyor (taburcu/transfer edilen kart ekranda bayatlar). → Grup 2
- `/notifications` kapsam kontrolü hâlâ `patient_board` ile kart kuruyor (zararsız, tek yol değil). → Grup 2
- `/ingest` hasta kimliği uzunluğunu sınırlamıyor; `/ack` ve `/view` 128 karakterle sınırlı. → Grup 2
- Denetim okumaları en ESKİ N satırı döndürüyor (`audit.py:255`, `audit_postgres.py:109`: `ORDER BY id ASC LIMIT n`): `/alarm-quality` (20 000) yoğun pilotta yeni epizotları kaçırır, `/audit` varsayılan 200 en eski olayları gösterir, `rehydrate` (1 000 000) sınırı aşınca en yeni ack/first_seen/kayıtları kaybeder; `limit`'lerin üst sınırı da yok. → Grup 2, alarm kalitesi paneli yeniden bağlanmadan ÖNCE
- Kapsam okunamadığında (UNKNOWN) `/patients` 200 + yanlış not dönüyor, `_require_patient` 404 + `scope_denied` yazıyor; her yerde 503 olmalı. → Grup 2
- Personel kapsamı yalnız pano uçlarında; kabul/eskalasyon/devir uçları kiracıya bağlı ama birime bağlı değil. → Grup 2 (karar 5)
- `api/board.py` NEWS2'yi tazelik uygulamadan hesaplıyor (`news2.score()`; tazelik yalnız kuralın `evaluate()`'inde): eski vitallerle kart "tam" görünebilir. → Grup 2 motor işi (G1-11 kabul ölçütü)
- Motor oda havası ve "Alert"i varsayıyor ama kısmi saymıyor (`rules/news2.py:140-143`). → klinik karar, kasaya dayanmalı (Grup 2; karar 7)
- Tüm uygulamanın rotalarını sınıflandıran tek bir test yok (scope/infinity/auth router'ları tabloda değil). → G1-03 öncesi küçük iş
- İzin açıklamaları güncel değil: `users.manage` kapsam atamayı, `devices.manage` canlı değerleri ve satıcı grubunu söylemiyor. → G1-13 — **kısmen**: roller tablosu açıklamaları artık sunucunun İngilizcesinden değil, izin anahtarına göre dört dilde kendi metninden gösteriyor (`strings/perms.js`; sunucunun metni yalnız bu derlemenin bilmediği bir anahtar için, İngilizce olarak işaretli yedek). Ama bu iki anahtarın panodaki metinleri de sunucununkiyle aynı eksikleri taşıyor; sunucudaki metin de değişmedi → "Dalga 3B'den açık kalanlar".
- Kısmi NEWS2 ipucu ve `NEWS2_MISSING_LABEL` yalnız Türkçe. → G1-06 ✅ Dört dilde `src/live/i18n/strings/news2.js`; karta G1-09 bağlar.
- `patientFromBoard` `identity.bed_id`/`unit_id`'yi okumuyor: her HBYS hastası "yatak bekliyor" görünür; birim filtresi ve kapsam matrisi için gerekli. → G1-09
- `auditRowFromRecord` kişi alanını `actor`'dan okumuyor (ack ve `scope_denied` satırları "—"); test fikstürü backend'in göndermediği `{by}` biçimini kullanıyor. → Grup 2
- Vite dev proxy'de `/admin`, `/scope`, `/scores`, `/infinity-research` yok (`/clinical` ve `/alarm-quality` var; yalnız `npm run dev`'i etkiler). → G1-07 ✅ `devProxy.test.js` nginx'in her API yolunu arar.
- `main.jsx`'te ölü `simulation` prop'u; PWA manifest `start_url: "/?demo=1"`. → G1-16 ✅ ikisi de Dalga 2'de düzeltildi: ölü prop gitti, manifest `start_url: "/"` ve `lang: "az"`. Yalnız **yeni** kurulumlar için geçerli: ana ekrana zaten eklenmiş bir kısayol, tarayıcı manifesti yeniden okuyana kadar `/?demo=1`'i — yani simülasyonu — açmayı sürdürür. Her tablette yeniden eklenmesi G1-15 deploy kapısında.
- `backendApi.myScope()` kullanılmıyor. → G1-12 ✅ Kullanıcılar sekmesi yöneticinin kendi kapsamını onunla okuyor: kapsam atama hakkı (`rules.canAssignScope`) yalnız `reason: "role"` iken var; yanıt gelmemişse bilinmiyor sayılır ve Kaydet çizilmez.
- `?infinityTest=1` yalnız ana çalışma ağacındaki commit'lenmemiş değişiklikte var. → kullanıcıya not
- `clinicalDemo.js:475`'teki demo yönetici parolası git geçmişinde; gerçek bir yerde kullanıldıysa değiştirilmeli. → kullanıcıya not
- `homunculus-ml/**/__pycache__/*.pyc` takipte (`324d2bd`'den beri). → ayrı temizlik
- `scripts/dev_local.py` SQLite'ta hâlâ tamamlanmaz: `seed_bootstrap` Postgres'e özgü kilit alıyor (`pg_advisory_xact_lock`), varsayılan yönetici parolası `Demo1234!` 12 karakter kuralına takılıyor, venv'de `aiosqlite` yok. → ayrı küçük iş

## Dalga 1A'dan açık kalanlar

- AD giriş sınırı (`auth/limits.py`, `directory_binds`: bir hatalı deneme dizisinde 3 hatalı
  bağlanma, kilit açmayla 3 daha; dizi 15 dakika hatasız geçince biter) bellekte tutuluyor:
  yeniden başlatma sıfırlar ve yalnız tek süreçte geçerli (birden çok
  uvicorn işçisi olursa paylaşılan depoya taşınmalı). Yönetici kilidi
  `POST /admin/users/{id}/unlock-sign-in` ile açabilir. Bir dizinin ortasında (son hatalı
  bağlanmadan sonraki 15 dakika içinde) yeniden başlatma ya da deploy, Homunculus'un sayacını
  siler ama AD'ninkini silmez: ardından 6 hatalı bağlanma daha gelebilir, AD'nin tek bir
  sayımında 12'ye kadar — eşik 7 varsayımı ancak yeniden başlatma yoksa geçerli. Runbook deploy
  öncesi son 15 dakikanın `login.fail` satırlarına bakmayı söyler (F7); F8'den beri yarıda
  kesilen ve parolası gitmiş girişler de satır bırakır (`cancelled`), sorgu onları da sayar.
  → pilot için kabul
- LDAP çalışma zamanının `close()`'u geri alınamaz (iş parçacığı havuzu kapanır): süreç
  başına tek lifespan. prodserver için sorun değil; aynı süreçte uygulamayı yeniden başlatan
  bir araç yeni bir çalışma zamanı kurmalı.
- Dizin havuzunun iş parçacıkları daemon değil: kapanışta asılı bir dizin çağrısı, soket
  zaman aşımı dolana kadar (LDAP_TIMEOUT_S, en çok 10 s) süreci bekletebilir.
- nginx giriş sınırı adres başına (dakikada 10, ani 10): servis PC'leri tek bir NAT ya da
  terminal sunucusu (Citrix vb.) arkasındaysa bütün servis aynı adresten gelir ve vardiya
  değişiminde klinisyenler 429 alabilir; aynı adresin arkasındaki herhangi biri dakikadaki 10
  hakkı harcayarak bütün servisi 429'da da tutabilir → hastaneye soruluyor ("Hastaneden
  gerekenler" 6), G1-15 öncesi. nginx'in 429'u artık JSON gövdeyle gelir; panel dört dilde
  "çok fazla giriş denemesi" der. Reddedilen giriş nginx günlüğüne `warn` düzeyinde yazılır.
- Adres başına sınır, nginx'in istemcinin gerçek adresini görmesine bağlı: Docker köprüsü
  adresleri ağ geçidi adresine çeviriyorsa bütün servis tek "adres" olur. VM'de nginx erişim
  günlüğünde servis PC'lerinin IP'leri mi, köprünün ağ geçidi mi göründüğü kontrol edilmeli.
  → G1-15
- Başarısız girişin alt sınırı (0,5 s) büyük bir AD'de hata yolundan kısa kalabilir (servis
  bağlanması + arama + iç içe grup araması + kullanıcı bağlanması): o zaman yanıt süresi
  hesabın AD hesabı olduğunu yine belli eder. Siteye göre ayarlanmalı ya da iç içe grup
  araması yalnız başarılı bağlanmadan sonra yapılmalı. → G1-15
- 50 kişilik içe aktarma yavaş DC'de (çağrı başına ~2 s; bir içe aktarma şeridin 3 yerinden
  en çok 2'sini kullanır) ~50 s sürebilir: panel 15 s'de keser; sunucu işi bitirir, tekrar
  güvenli (içe aktarma idempotent) → G1-14 içe aktarmayı 10'arlı parçalar. İçe aktarmanın
  toplam süresi 2 × süre sınırıyla sınırlı DEĞİL: n hesap en kötü ≈ ⌈n/2⌉ × 2 × süre sınırı
  (50 hesap, varsayılan ayarla ≈ 25 × 20 s) sürebilir; sınırlı olan tek tek çağrılardır.
- Yönetici şeridinde bekleme için üst sınır yok → ✅ F5'te çözüldü: yer beklemesi çağrının süre
  sınırıyla sınırlı (aşılırsa 503); TEK bir içe aktarma şeritte bir yeri boş bırakır (arama,
  grup seçici, bağlantı testi onun arkasında beklemez). Aynı anda iki içe aktarma şeridin 3
  yerini doldurabilir: arama o zaman en çok süre sınırı kadar bekler ve 503 alır (sınırlı,
  asılmaz). Bir yönetici çağrısı en çok 2 × süre sınırı (varsayılan 20 s, en çok 24 s) sürer:
  şerit doluyken ve DC yavaşken panelin 15 s'sini aşabilir.
- İçe aktarma dizini beklerken bir veritabanı bağlantısı tutuyor → ✅ F5'te çözüldü: dizine
  soran dört yönetici ucu (test, arama, gruplar, içe aktarma) bağlantıyı önce havuza geri
  verir; başarısız girişin alt sınır beklemesi de bağlantısız yapılır.
- AD grup eşlemesi grubun DN'iyle anahtarlanıyor: grup AD'de yeniden adlandırılır ya da başka
  bir OU'ya taşınırsa eşleme sessizce kopar (üyeler eşlenen grubu bir sonraki girişte ya da
  yenilemede kaybeder). Eşlemeyi grubun objectGUID'i ya da SID'iyle anahtarlamak → Grup 4
- DN'ler yalnız ASCII harfleri küçültülerek karşılaştırılıyor (F5): AD'nin kendisi `Ş`/`ş` gibi
  harfleri eşit sayar, Homunculus saymaz. Eşleme grup seçiciden yapıldığında AD'nin yazımı
  birebir gelir; elle yazılan bir DN'de ASCII dışı harflerin büyük/küçük yazımı AD'dekiyle aynı
  olmalı. DN'ler kanonik yazıma geçmeden önce (bütünüyle küçültülerek) saklanan ve DN'inde
  ASCII dışı büyük harf olan bir eşleme satırı artık eşleşmez (eski satır `Ç`'yi `ç` yaptı,
  kanonik yazım AD'nin `Ç`'sini korur): böyle bir satır silinip seçiciden yeniden
  oluşturulmalı. Bu dal hiç dağıtılmadı; dağıtımda böyle satır yok. → G1-14 (AD paneli bunu
  göz önünde tutmalı)
- AD'de yeniden adlandırılan hesap izlenmiyor (plan "Spec gaps" 7): girişte ad, e-posta ve DN
  güncelleniyor ama `username` değil, yönetimde yeniden adlandırma yolu da yok; AD'de adı
  değişen kişi ne eski ne yeni sAMAccountName'iyle girebilir, yalnız Homunculus'taki
  e-postasıyla girer. AD'de silinip aynı sAMAccountName'le yeniden oluşturulan hesap (yeni
  objectGUID) da hiç içe aktarılamaz: ad Homunculus'taki eski hesapta kayıtlı (`login_taken`),
  kullanıcı adı değiştirilemez, kullanıcı silinemez. İkisi birlikte çözülmeli. → Grup 4
- Yenileme, dizine ulaşılamadığında (`unreachable`, `timeout`, `tls`,
  `service_bind_rejected`; `auth/router.py`, `_REFRESH_OUTAGES`) oturumu dizine sormadan
  sürdürür: VM ile DC arasındaki bağlantı kesik kaldıkça, AD'de devre dışı bırakılmış bir
  hesabın çalınmış yenileme token'ı da yaşar. Başarılı bir dizin denetimi olmadan bir oturumun
  ne kadar yenilenebileceğine üst sınır konmalı. → Grup 4
- `tests/test_ldap_integration.py` yalnız gerçek dizine karşı, elle koşuyor: CI için Samba AD
  (ya da benzeri) ile bir tarif yazılmalı. → Grup 4
- **G1-14 notu:** `/admin/ldap` çağrıları 2 × süre sınırı (varsayılan ≈20 s, en çok 24 s)
  sürebilir, dashboard'un 15 s zaman aşımını aşar — panel bu uçlar için daha uzun zaman aşımı
  kullanmalı; içe aktarma 10'arlı parçalar. Eşleme ekleme/silme yalnız bütün kataloğu taşıyana
  açık (403 `AD grup eşlemesini yalnız tüm yetkilere sahip bir yönetici değiştirebilir`): panel
  bu düğmeleri ona göre gösterir. → G1-14
- AD giriş sınırı kayan pencere: en eski hata 15 dakikayı doldurunca yeni deneme açılıyor, yani
  beş dakikada bir girilen yanlış parola hiç reddedilmiyordu; AD ise sayacını ancak "Reset
  account lockout counter after" süresi hatasız geçince sıfırlar → ✅ F6'da çözüldü: sınır
  AD'nin mantığıyla sayar (`FailureChain`): hatalı deneme dizisi SON hatadan sonra 15 dakika
  hatasız geçince biter, dizide 3 hatadan sonra o ana dek ret (ret diziyi uzatmaz); yöneticinin
  kilit açması dizi başına bir kez, 3 deneme daha (hatası olmayan hesapta hiçbir şey vermez,
  hakkı harcamaz). Bir dizi en çok 3 + 3 = 6 hatalı bağlanma: AD'nin sıfırlama süresi en çok
  15 dakikaysa Homunculus tek başına AD sayacına sıfırlanmadan en çok 6 ekler, eşik en az 7
  (hastaneden istenecekler 7). Gerçek sınıflarla 2 saatlik benzetim testi
  (`tests/test_auth_limits.py`).
- Başarılı giriş, kendisi denetlenirken başarısız olan yanlış parolaları da unutuyordu: onların
  bağlanması DC'ye başarılı olanınkinden sonra ulaşmışsa AD onları sayar; inceleme AD'de 9'a
  (kilit açmalarla 12'ye) ulaştı → ✅ F7'de çözüldü: `begin` bir bilet (`Ticket`) verir;
  başarılı giriş yalnız kendisi başlamadan önce kaydedilen hataları unutur, sonrakiler yeni
  diziyi başlatır (dizinin kilit açma hakkı harcanmışsa harcanmış kalır). Süre sınırında kesilen
  ve parolası gitmiş bir bağlanma bir süre sınırı sonrasıyla tarihlenir; kullanıcı bağlanması
  isteği bağlantı (TCP, TLS) açıldıktan sonra gönderilir, `bind_attempted` "parola gitti"
  demektir. Benzetim artık başarılı girişleri ve kesilen bağlanmaları da karıştırıyor; eski
  davranışın sınırı aştığını da gösteriyor.
- ✅ F7'de çözüldü (Dalga 1A son incelemesi): parolalar ldap3'e UTF-8 bayt olarak gider
  (SASLprep yok: NBSP, yumuşak tire, ayrışık `ş` içeren doğru parola artık 401 almıyor);
  üretimde `homunculus` günlüğü INFO düzeyinde yazılıyor (başlangıçtaki "succeeded" satırı
  görünür) ve runbook önce `/admin/ldap/status`'a bakar; `LDAP_ALLOW_INSECURE=1` üretimde
  LDAP'ı kapalı tutar; `.dockerignore` `.db`/`__pycache__`'i her derinlikte dışlar; kilit
  açmanın denetim satırı doğru (`failed`, `allowed` 3/6, `granted`) ve ikinci kilit açmanın
  metni dizi mantığını söyler; sertifika reddi gerçek bir TLS bağlantısında test edildi.
- F7 yalnız süre sınırında (2 × `LDAP_TIMEOUT_S`) kesilen bağlanmayı bir süre sınırı sonrasıyla
  tarihliyordu; ama ldap3'ün alma zaman aşımı (`LDAP_TIMEOUT_S`, yukarı yuvarlanır) ondan önce
  dolar ve takılan bağlanmaların çoğu oradan bitiyordu: parola gitmiş, DC yanıt vermemiş, hata
  "şimdi" tarihleniyordu — AD onu Homunculus'un kapattığı bir diziden sonra da sayabiliyordu
  (inceleme senaryosunda AD 7'ye, modelinde 14'e ulaştı) → ✅ F8'de çözüldü: parolası gidip DC'den
  yanıt alamayan her bağlanma, beklemeyi ne bitirmiş olursa olsun (alma zaman aşımı, kopan
  bağlantı, okunamayan yanıt, süre sınırı, iptal), bir süre sınırı sonrasıyla tarihlenir; yalnız
  DC'nin yanıtladığı bağlanma (bir sonuç kodu) yanıt anıyla. Tohumlu 4 000 senaryoluk model
  testi (`tests/test_directory_bind_invariant.py`, gerçek `FailureChain`, alma zaman aşımı yolu
  dahil) AD sayacının en çok 6'ya çıktığını denetler (eski tarihlemeyle 9). İsteği gönderildikten
  bir süre sınırından daha geç işleyen bir DC güvencenin dışındadır (runbook'ta yazılı). Aynı
  turda: sınırın saydığı her hata o anda denetime yazılır — yarıda kesilen ve parolası gitmiş
  giriş `login.fail` `cancelled`, bir hata `directory_error`; giriş, hesabın bağlanıp
  bağlanmadığını saatten değil dizinden öğrenir (`LdapIdentity.bound`: saat `accountExpires`'ın
  gerisine kayınca süresi dolmuş hesap parolasız giriyordu); `FailureChain` yanlış kullanımda
  (başka hesabın bileti, iki kez `end`, `end`'den önce `succeeded`) hata verir.
- Geliştirme venv'i Python 3.14, üretim imajı 3.12 — testler artık iki yorumlayıcıda da
  koşuyor (F6: 3.12'de `TaskGroup` bir alt görev hata verince üst görevi iptal edilmiş
  bırakıyordu ve içe aktarmadaki her dizin kesintisi 503 yerine 500 oluyordu). CI'da 3.12
  koşusu yok → Grup 4
- İmajlar sabit sürümlerle kurulur (F6): `homunculus-engine/constraints.txt`, temiz bir
  python:3.12-slim kurulumunun `pip freeze`'i (`.[dev]`, proje hariç); `Dockerfile.api`
  `pip install -c constraints.txt .`, köprü imajı tek paketi `cryptography`'yi aynı dosyayla
  sabitler. `pip install .` SQLAlchemy 2.1'i `greenlet`'siz kuruyordu (API açılamıyordu);
  bağımlılık artık `sqlalchemy[asyncio]>=2.0,<2.2`. Dosya `pyproject.toml` değişince yeniden
  üretilir ve test takımı 3.12'de ona karşı koşturulur. 3.14 geliştirme venv'i bu seti
  kendiliğinden kullanmaz (F7'de görüldü: SQLAlchemy 2.0.51 vb.); hizalamak için
  `homunculus-engine/` içinde `pip install -c constraints.txt -e ".[dev]"`. SQLAlchemy 2.1 çıplak `postgresql://`
  adresini psycopg2'ye değil psycopg 3'e (kurulu değil) çözer: üretim kodu sürücüyü zaten
  adıyla veriyordu (asyncpg, `to_sync_url` → psycopg2); test fikstürü `clean_db` de artık
  veriyor.

## Dalga 1B'den açık kalanlar

- Giriş kutusu kenarı (`--line2`) kart/card2'de 1,4–1,6:1 (WCAG 3:1); odakta `--pri` olur.
  → "Kullanıcı kararları", 10.
- Prototip dışı yeni metinler (`risk.none/unmeasured/unknown/unreported`, `news2.*`, galerinin çoğu)
  ve AZ "düşük" etiketi `Aşağı` (prototipte cihaz önceliğiydi, risk düzeyi olarak okunmalı)
  AZ/RU/EN'de anadili konuşan bir klinisyenin okumasını bekliyor → pilot öncesi.
  Listeye ek: `ui.toast.warn/error` (ekran okuyucu her uyarı/hata bildiriminden önce okur),
  `ui.sample.*` (galeri) ve "motor/engine" sözcüğü — RU'da "Движок" araba motoru gibi okunduğu
  için "Система" yapıldı; aynı sorun AZ `news2.noEngine` "Mühərrik" ve TR "Motor" için de geçerli.
- Prototipin Gün temasında monitör paneli (`--monbg`) üzerindeki vital renkleri 1,2–3,8:1; `--monbg` taşınmadı → Grup 2 monitörü taşırken düzeltir.
- Otomatik tema (20:00–08:00) yalnız mobil prototipte vardı; web için ertelendi → G1-07 ya da sonrası. Dalga 2'de de yapılmadı (web prototipinde yok).
- Gün'de iki dolgu card2/sayfa/app üzerinde 3:1'in altındaydı (G1-07/G1-09 nokta ve şeritleri oraya koyar).
  En küçük değişiklik, ton korunarak (`tokens.css`; plan dosyasının Kontrast tablosu,
  `2026-10-03-g1-dalga1b-tasarim-temeli.md:45`, eski `#c28406`'yı gösterir): ✅
  - `--mid` `#c28406` → `#ba7f07`: kart 3,43 · card2 3,11 · sayfa 3,00 · app 3,17 (önce card2 2,89, sayfa 2,79).
  - `--ok` `#16a34a` → `#179f49`: kart 3,45 · card2 3,12 · sayfa 3,02 · app 3,18 (önce card2 2,99, sayfa 2,89).
- Gün'de vital renkleri card2 üzerinde 4,5:1'in altında: `--v-map` 4,38, `--v-spo` 4,46
  (kartta geçer). Değer değişmedi → G1-09/G1-11 vitalleri nereye koyacağına karar verirken.
- Button `busy` (işlem sürerken) durumu → G1-10, ilk kullanımda. ✅ Eklendi (`6ab73a0`):
  `aria-busy`, odakta kalır, tıklamayı ve form gönderimini yok sayar.
- Dil, tema ve yazı boyutu sekmeler arası eşlenmiyor (`storage` olayı dinlenmiyor):
  bir sekmede değişince öbürü eskisinde kalır → G1-07. ✅ `storage` olayı dinleniyor (Dalga 2).
- Ekran okuyucu risk hapında yalnız düzeyi okur ("Orta"); görünmez "Risk:" öneki → G1-09.
- Pencere açıkken bildirime (toast) klavyeyle ulaşılamaz: pencere Tab'ı içinde tutar.
  Fareyle kapanır; yığın o sırada sağ üste çıkar (sağ altta altbilgiyi örtüyordu,
  390×380) → G1-10.
- `Field` hatası canlı bölge değil: gönderimde çağıran ilk geçersiz alana odaklanır,
  ekran okuyucu hatayı alanla birlikte okur → G1-08/G1-12 formları. ✅ G1-08'in bütün formları böyle (giriş, kod, şifre, kilit).
- Meşgul `Button` ekran okuyucuda yalnız "kullanılamaz" okunur; görünmez bir
  "kaydediliyor…" metni düşünülmeli → G1-10, ilk kullanımda.
- `ThemeProvider` sökülünce `<html>` özniteliklerini önceki değerlerine döndürmez,
  siler; `I18nProvider` `<html lang>`'ı bırakır → G1-07. ✅ önceki değerler geri konuyor.
- Tutarlılık notu: `StatusPill`/`Tag` bilinmeyen tonu nötre düşürür; `riskStyle` ise
  bilinmeyen riski dikkat görünümüne çeker. Çağıranlar yalnız bilinen tonu geçer. → G1-09
- G1-07 başında küçük işler (Dalga 1B son incelemesi): `ui/index.js` `MODAL_EXEMPT`,
  `MODAL_OPEN`, `TOAST_WARN_MS`, `TOAST_MAX`'i de dışa versin; `TabPanel` `id`'siz
  `undefined-panel-0` üretiyor (koruma/uyarı); `riskStyle(risk, null)` atar (`opts ?? {}`);
  kabuk `ToastProvider`'ı köke koymalı (`useToast` sağlayıcısız sessiz kalır); Gün temasında
  `<body>` arka planı hâlâ koyu (`index.css`) — kabuk `bg-page` boyar; bileşen ton sözlükleri
  (Tag/Note/StatusPill/Toast) `index.js` başlığında eşlensin. → G1-07 ✅ hepsi (Dalga 2, Görev 6; kök `ToastProvider` ve `bg-page` `LiveApp.jsx`'te).
- Giriş hatası için duyurulan satır içi uyarı gerekir (`Note` statik, `role="note"`). → G1-08 ✅ `ui/Alert.jsx` (`role="alert"` / `"status"`).
- Pencere `busy` ile altbilgi Kaydet'in `busy`'si ayrı; çağıran ikisini eş tutar,
  galeride örnek yok. → G1-10
- `color-mix()` Chrome 111 / Safari 16.2, `inert` Chrome 102 ister; derleme hedefi Chrome 87.
  Eski tarayıcıda hap renk tonu kaybolur (metin okunur kalır), pencerenin ekran okuyucu
  yalıtımı kaybolur. Servis PC'lerindeki Chrome sürümü pilottan önce doğrulanmalı. → kullanıcıya not
- Servis çalışanı galeri parçasını ve 10 font dosyasını da önbelleğe alıyor (19→29 kayıt,
  940→1130 KiB); G1-07 fontları zaten kullanır, galeriyi `globIgnores` ile dışarıda bırakmak → G1-16.
  Kısmen yapıldı (Dalga 2): simülasyon parçası (`legacyRoots-*.js`) ve replay verisi (`demo/**`)
  önbellekten çıktı, 31 kayıt/1245 KiB → 22 kayıt/556 KiB. Galeri parçası (`?tasarim=1`) ve
  fontlar hâlâ önbellekte → G1-16.
- Test boşlukları: `Table`'ın `ResizeObserver` yolu (jsdom'da yok, yalnız `resize` yedeği
  test ediliyor) ve `Empty` testinin yalnız metni denetlemesi. → G1-07 ✅ ikisi de test edildi.
- Türkçe rehbere risk gösterim kuralları girsin (asla yeşil; "ölçülmedi" ≠ "bulgu yok";
  bilinmeyen/bildirilmeyen → dikkat). → G1-09

## Dalga 2'den açık kalanlar

- `?eski=1` (önceki canlı arayüz) kilit ekranını bilmez: kilitli bir tarayıcıda yeni sekmede
  `?eski=1` açılırsa oturum açık görünür → G1-16 kaldırır (G1-15 deploy'undan önce).
- Sunucu tarafı çıkış yok: çıkış token'ları tarayıcıdan siler; tarayıcıdan alınmış bir yenileme
  token'ı süresi dolana (7 gün) ya da hesap değişene dek geçerli kalır → ayrı iş (Grup 4).
- Açık bir akış (SSE) oturum ortasında kesilmiyor: hesap işaretlenince (geçici şifre),
  pasifleştirilince ya da `token_version` artınca akış akmaya devam eder; istemci ilk istekte
  ya da ilk yenilemede durur (bugünkü davranış) → Grup 4.
- Mobil uygulamada şifre değiştirme formu yok: geçici şifreli hesap mobilde girişte "önce panodan
  şifrenizi belirleyin" der → mobil işi (Grup 5).
- Mobil, bilinen eksikler (Grup 5): Ayarlar ekranındaki `hasSession` oturum bittikten sonra
  yeniden kurulana dek eski değerde kalıyor; `BoardProvider.tsx:210`'daki `void transport.ack(...)`
  reddedilen bir onayı (geçici şifre hatası dahil) yakalamıyor; tabanda 3 test kırık
  (`charter.test.ts`, `recording.test.ts`) ve `recording.test.ts:19`'da `tsc` TS1360.
- **G1-09 notu:** birim çipi 640 px ve altında gizli (telefonda birim seçilemez), ve seçilen birim
  her kilitte unutulur (kabuk yeniden kurulur) — G1-09 yataklar ekranında ikisini de ele alır
  (ör. ekranın kendi birim seçimi; seçimin oturum boyunca saklanması).
- Kilit sayacı (yerel hesapta `reauth_failures`) AD sınırı gibi bellekte: yeniden başlatma
  sıfırlar, tek süreç → pilot için kabul (Dalga 1A'daki AD sınırıyla aynı karar).
- Zil: alarm ekranı (G1-10) gelince her satır hastaya/alarma bağlanır ve sol menüdeki Alarmlar
  maddesine sayaç gelir → G1-10.
- Pano yeniden yüklendikten sonra gelen akış kareleri "istek gönderildikten sonra geldi" =
  "anlık görüntüden yeni" varsayımıyla üst üste konuyor; isteğin gönderilmesinden sonraya sarkan
  eski bir kare daha yeni bir anlık görüntünün üzerine yazılabilir (dar bir durum). Kalıcı çözüm
  `/patients` kayıtlarında ve karelerde sunucu tarafı sıra numarası, sonra "yeni olan kazanır"
  → Grup 2 (motor + pano).
- `/notifications` akışının kalp atışı (heartbeat) yok; yalnız eski çalışma alanı okuyor →
  G1-16'yla birlikte kalkar, kalacaksa kalp atışı eklenir.
- `reset_password` kilit sayacını commit'ten önce sıfırlıyor (yöneticinin kendi işlemi, zararsız)
  — kabul edildi.
- **Dalga 3 için notlar:** `resumePath` yalnız "`nav:false` ve parametresi var" durumunu reddeder,
  yani ileride parametreli bir ANA rota gelirse (`/beds/:unit`) kilit sonrası ona dönülür — o rota
  eklenince kural genişletilmeli. `stubScreens()` iç içe kullanılırsa katmanlar LIFO çözülmez
  (içteki çağrı dıştakini de temizler). `Shell.jsx` boş adreste `resumeTo.current ||
  home`'a gider: oturum ortasında hash silinirse ana ekran değil hatırlanan ekran açılır (zararsız).
- Yeni metinler (`nav`, `shell`, `auth`, `lock`, `account`, `errors`'ın çoğu) AZ/RU/EN'de anadili
  konuşan bir klinisyenin okumasını bekliyor → pilot öncesi.

## Dalga 3B'den açık kalanlar

Plan: [dalga 3B](2026-10-12-g1-dalga3b-yonetim-ekranlari.md) (G1-12/G1-13/G1-14 ve arka uç yarısı,
Görev 14). Sayılar yukarıda, iş listesinin altında.

**Yapılmadı — kullanıcının ya da hastanenin işi:**

- **Tarayıcıda bakış** (390 px ve 1440 px, iki temada; Görev 12 Adım 5) yapılmadı, kullanıcı
  yapacak. Bakılacaklar: 390 px'te sekme listesi (iki ayrı liste gibi iki satıra kırılmamalı,
  sekme listesi olarak kaymalı); kullanıcılar sekmesinde alınan bir ret bildirimi roller sekmesine
  geçince ekranda kalıyor mu (hiçbir birim testi sekme değişimini gözlemiyor); roller tablosu yana
  kayarken ilk sütun yerinde kalıyor mu; üyesi olduğu için silinemeyen bir grubun nedeni sütun
  başlığına sığıyor mu.
- Bağlantı testinin beş gerçek nedeni hastanenin etki alanı denetleyicisi olmadan denenemez;
  yalnız taklitle test edildi → G1-15 kapısında bir madde.
- AD ile girişin VM'de açılması BT biriminin yanıtlarını bekliyor (`docs/active-directory-bt-sorulari.md`,
  yukarıda "Hastaneden gerekenler").
- VM'ye hiçbir şey çıkmadı: kullanıcının kararı (07.10.2026) — Grup 1'in tamamı kendi kapısından
  geçmeden VM'ye bir şey gitmez (yukarıda "Bu dal VM'ye çıkmaz").

**Bilerek bırakılanlar:**

- **`GET /admin/users` sınırsız** (pilot için kullanıcının kararı): sekme bütün hastaneyi tek
  istekte yükler, tarayıcıda süzer, 50'şer satır çizer ve 200 ya da daha çok hesapta bunu ekranda söyler.
  **Sunucu tarafı sayfalama ikinci bir hastaneden önce** gerekir.
- **Toplu kapsam okuması yok:** `GET /scope/{id}` kullanıcı başına, `/scope/unassigned` yalnız bir
  sayı. Birimler sütunu bir kullanıcının kapsamı okunana dek "Okunmadı" der (düzenleyici açılınca
  okunur); satır başına bir istek bilerek yapılmadı (dizin çağrılarıyla aynı yönetici şeridini
  tüketir). Sütunun gerçek olması için toplu bir kapsam okuması gerekir → hedef grup seçilmedi.
- **Roller sekmesinde sekme değiştirmek bekleyen işaretleri düşürür** (inceleme bulgusu P5):
  `AdminScreen` yalnız açık sekmeyi kurar. Görünür (dönünce sütun işaretsiz), yanlış bir iddia
  değil. Seçenekler: bekleyenleri `AdminScreen`'e taşımak ya da kaydedilmemiş değişiklikle sekmeden
  çıkarken sormak → Grup 3.
- **Bir izin anahtarı ekleyen sürümden önce alınmış token:** bütün yetkileri olan bir yönetici o
  token'ın ömrü boyunca (en çok 60 dakika) yeni anahtarın hücrelerini "bu yetkiye sahip
  değilsiniz", o anahtarı taşıyan grubu "yetkilerinizi aşıyor" diye görür; sunucu (yetkileri
  veritabanından okur) kabul ederdi. Seçenekler: pano sistem grubu üyesini bütün kataloğu taşıyor
  saysın ya da bir sürüm bütün token sürümlerini artırsın → Grup 3.
- **AD'den gelen bir Sistem Yöneticisi üyeliği son yönetici korumasında hiç sayılmaz:**
  `count_admins` bilerek yalnız YEREL üyeleri sayar (AD kesintisi yöneticilerin hepsini
  kilitlememeli). Yalnız AD yöneticileri kalan bir hastanede son yerel yöneticinin kaldırılması
  reddedilir — doğru — ama kullanıcılar ve giriş kaynağı sekmeleri bir AD `hospital_admin`'inin
  neden "sayılmadığını" söylemiyor. Bütün yetkileri olan bir masa iki sekmeden de
  `hospital_admin` verebilir (sunucu kabul eder; yeni bir yetki yolu değil). Ekranda ipucu → Grup 3.
- **Kilit sırasında sonuçlanan başarılı bir yazma onaylanmaz:** kullanıcı formu ve kapsam
  düzenleyicisi başarıyı yalnız ekrandayken onaylar (ret her durumda bildirime düşer); kilit
  kabuğu kaldırır, yani kilit sırasında biten bir kayıt sessizdir ve kilitte biten bir kapsam
  kaydı Birimler hücresini bir sonraki okumaya dek eski bırakır. `6c6b4f6`'dan beri bildirimler
  kilit boyunca tutulduğu için başarı bildirimi koşulsuz (oturuma bağlı) verilebilir → Grup 3.
- **İki izin açıklaması eski:** `auth/permissions.PERMISSIONS`'ta `users.manage` birim kapsamı
  rotalarını (`/scope/{id}`, `/scope/unassigned`, `PUT /scope/{id}`), `devices.manage` cihaz
  araştırma penceresini ve satıcı grubunun (`platform_support`) onu taşıdığını söylemiyor. Pano
  açıklamaları anahtara göre kendi metninden gösteriyor, ama bu iki anahtarın dört dildeki
  metinleri (`strings/perms.js`) sunucununkinden yazıldı ve aynı eksikleri ekranda da taşıyor.
  İkisi birlikte düzeltilir.
- **"Canlı bileşende onaltılık renk ya da Tailwind paleti rengi yok" kuralını sınayan test yok:**
  kural incelemeyle korunuyor, testle değil. Dalganın düşünüp kurmadığı tek sistemli ağ;
  `rawKeys.test.jsx`'teki statik anahtar ağının yanında yaklaşık yirmi satır.
- `tests/test_infinity_vm_pilot.py` yük altında asılı kalıyor (PowerShell alt sürecinin `kill()`'i
  `communicate()`'i bitirmiyor); düzelene dek iki tam backend koşusu aynı makinede birlikte
  koşulmaz → Grup 4 (test düzeni).

**Bu dalganın kapattıkları:**

- ✅ **Kayıp güncellemeler gerçekti; artık sunucu kapatıyor (Görev 14e, `65d6a36`).** Sunucu bir
  grubun izinlerini ve bir kullanıcının elle verilmiş üyeliklerini sürümsüz, bütün küme olarak
  değiştiriyordu: eski bir görünümden yapılan kayıt başka bir yöneticinin değişikliğini sessizce
  geri alıyordu ve panodaki "409 gelirse yeniden oku" yolları 14e'ye dek ölüydü (bu rotaların
  "aynı anda değiştirildi" 409'u yalnız kilitlerin erişilmez kıldığı bir IntegrityError'dan
  gelebiliyordu). Şimdi
  `PATCH /admin/groups/{id}` `expected_permissions`'ı, `PUT /admin/users/{id}/groups`
  `expected_group_ids`'i alır; ikisi de kiracı kilidi altında (grupta satır kilidiyle birlikte),
  hiçbir şey yazılmadan **küme olarak** karşılaştırılır; farklıysa 409 `CONCURRENT_CHANGE`,
  hiçbir şey yazılmaz, denetim satırı da olmaz. Grup, `GroupOut`'un sunduğuyla karşılaştırılır
  (`served_permissions`; sistem grubu için bütün katalog) — yoksa sistem grubu sonsuza dek 409
  alırdı; kullanıcı yalnız ELLE verilmiş üyelikleriyle, AD'den gelenler dışarıda. Alan
  gönderilmezse yazma eskisi gibi. Roller sütunu 409'da yeniden okunur ve işaretler kalır;
  kullanıcı formu 409'da kapanır ve hesabın başka masada değiştirildiğini söyler.
- ✅ **Kullanıcı formu yalnız değişen alanları gönderir** (`9f49cb3`): bir ad düzeltmesi son
  okunan `is_active`'i yeniden gönderiyor ve başka bir masanın pasifleştirdiği hesabı yeniden
  etkinleştiriyordu — "kaydedildi" diyerek.
- ✅ **Yanıtsız kalan bir yazma için tek kural** (`3beedea`): `refusal.js` `mayHaveLanded`
  `errors.requestTimeout`, `errors.serverUnreachable` ve `errors.network`'ü kapsar. Böyle biten bir
  YAZMA "gitmiş olabilir" der (`admin.mayHaveLanded`; zaman aşımı bunu kendi cümlesinde zaten
  söylüyor) ve ekran dokunduğunu yeniden okur. Okumalar bunu hiç demez; dizin bağlantı testi
  okuma gibi yazıldı.
- ✅ **Bildirimler ve kilit ekranı** (`6c6b4f6`, `afaab61`): `ToastProvider` `open`/`session`
  alır — bildirimler kilit ekranı boyunca tutulur ve kilit açılınca gösterilir, başka bir oturuma
  taşınmaz, `useToast()` kendi oturumuna bağlıdır. Ekranlar YAZMALARINI çıkışa karşı yine kendileri
  `store.epoch()` ile korur (kullanıcılar ve giriş kaynağı sekmeleri).
- ✅ **AD'den içe aktarma:** 2'şer hesaplık parçalarla, kesinlikle sırayla. Yönetici sekmeden
  ayrılırsa aktarma biter ve sonucu bildirime düşer; çıkış yapılırsa sessizce durur. Yarıda kalan
  bir aktarma da — bir hesap aktarılmışsa ya da başarısız parça gitmiş olabilirse — listeleri
  yeniden okur. "exists" o dizin kullanıcısı için bir hesap olduğunu söyler — başka bir hastanede
  de olabilir.
- ✅ **Karar X2:** bir masanın veremeyeceği grup gizlenmez, nedeniyle birlikte seçilemez gösterilir
  — kullanıcı formunda da, içe aktarmanın ek grubunda da.
- ✅ **Görev 14 (`fa8c522`):** `POST /admin/users/{id}/unlock-sign-in` `{ok, granted,
  allowed_before, allowed_after}` döner (eskiden yalnız `{ok: true}`; ekran "üç deneme daha" ile
  "açılacak bir şey yoktu"yu ayırt edemiyordu, şimdi sunucunun sayısını söylüyor); `GroupOut.kind`
  (`"role"` / `"extra"`, hastanenin açtığı grup için `null`) ve `ScopeView.own_patients` (yalnız
  sayı) yeni; `/scope/unassigned` yöneticileri ve platform operatörlerini saymıyor; `/scope/me`
  panoyla aynı kararı veriyor (yukarıda G1-12 kabul ölçütü).

## Kullanıcı kararları (Dalga 0 sonrası)

Öncelik sırasıyla. (12–17 numaralı kararlar Dalga 2'de soruldu ve yanıtlandı: yukarıda
"Dalga 2'de kullanıcının verdiği kararlar".)

1. **VM bugün (bu daldan bağımsız):** risk eşlemesi hatası VM'de de var (orta risk yeşil görünüyor) — VM'ye hotfix mi, G1-09'u mu bekler? VM'nin nginx'i `/clinical`, `/scores`, `/alarm-quality`'yi iletiyor mu (iletmiyorsa VM'de klinik giriş/SOFA imzası motora hiç ulaşmamış olabilir)? Kontrol: `curl -sk -X POST https://<vm>/clinical/x -H 'Authorization: Bearer x'` → JSON 401 = iletiliyor, HTML/405 = iletilmiyor.
2. **G1-15 deploy kapısı:** Grup 2–4'e kalan VM yetenekleri (özellikle vazopressör/sıvı girişi, hasta normali, kabul profili, besleme sağlığı) kaybedilsin mi, Grup 1'e mi alınsın, yoksa deploy beklesin mi?
3. **Geçişte zorunlu MFA:** 4 grup (Sistem Yöneticisi, Sorumlu Hekim, Ünite Hekimi, Üretici Destek) ilk girişte TOTP kuracak (VM hiç zorlamadı) — kabul mü, pilot için gevşetilsin mi?
4. **Cihaz token'ı:** `/clinical` ile klinik kayıt ve hasta normali yazabiliyor (main'deki gibi; profil alarmları düşürebilir) — reddedilsin mi (repo'da kullanan tek yer `scripts/dev_seed_ward.py`, JWT'ye taşınır), kalsın mı?
5. **Kapsamın erimi:** kabul/eskalasyon/devir uçlarına da kapsam uygulansın mı; `SCOPE_ENFORCE_UNASSIGNED` altında denetçi tam ize erişsin mi?
6. **Satıcı erişimi:** `platform_support` canlı araştırma penceresini ve tam denetim izini görsün mü, görmesin mi?
7. **NEWS2 sunumu:** bayat vitallerle skor nasıl gösterilir; varsayılan oda havası/"Alert" kısmi sayılsın mı — klinik karar (kasa).
8. **Test hesapları:** VM'de `seed_test_users` ile hesap açıldıysa `0010`'dan önce pasifleştirilmeli; aksi halde test yöneticisi `hospital_admin` olur ve ilk girişte TOTP'yi parolayı bilen kurar. Kontrol: `SELECT email, is_active FROM users WHERE email LIKE 'test.%';`
9. **NEWS2 kırmızı parametre ve hasta normali çatışması:** `rules/news2.py` bir parametre
   3 puan alınca (`red_param`) ORTA alarm üretir (`news2.py:155-156`); ama
   `patient_relative._adjust_news2` (`patient_relative.py:80-110`) her katkıyı açıklanmış
   bulursa NEWS2'yi DÜŞÜK'e indirir. Açıklama iki yoldan gelir: hekimin girdiği kronik
   normal (vital tabanı) ya da kayıtlı bir eşlik eden hastalık (`patient_relative.py:98`):
   KOAH/kronik oksijen → oksijen, demans/kronik konfüzyon → bilinç. "Alert" dışı bilinç
   3 puandır (`news2.py:87-89`), yani demans tek başına bir red_param'ı DÜŞÜK'e indirebilir. G1-09 kabul ölçütü
   "red_param kartı en az amber yapar" bununla çelişir. Klinik karar: kronik normal ya da
   eşlik eden hastalık red_param tabanını geçersiz kılsın mı? (kasaya dayanmalı)
10. **Giriş kutusu kenarlık kontrastı:** `--line2` kart/card2 üzerinde 1,37–1,63:1
    (iki temada); WCAG 1.4.11 arayüz bileşeni için 3:1 ister. Odakta `--pri` geçer.
    Tüm form kenarlıkları koyulaştırılsın mı? (görünüm değişir)
11. **Giriş denemesi sınırı herkese mi?** Bugün yalnız AD hesapları 3 hatalı denemede 429
    alıyor; bu, bir adın etkin AD hesabı olduğunu ele veriyor (bilinmeyen/yerel adlar hep
    401). Seçenekler: (a) olduğu gibi kabul, (b) bilinmeyen ve yerel adlara da aynı sınır
    (yerel hesaba "kilitleme" gelir; spec bunu reddetmişti), (c) yalnız bilinmeyen adlara
    sahte sınır (yerel hâlâ ayırt edilir). nginx'in adres başına sınırı (dakikada 10) bu
    yoklamayı yavaşlatır, kapatmaz.
    F7 ekleri, karar verilirken bilinmesi gerekenler: (a) Dizin kapalıyken ya da AD hesapları
    varken `LDAP_URL` boşken, AD hesabının girişi hemen 503 alır (sahte bcrypt yok, 0,5 s alt
    sınır yok), bilinmeyen ve yerel adlar 401 — AD hesapları bu yoldan da ayırt edilir.
    (b) Bir klinisyenin giriş adını bilen herkes, 15 dakikada 3 yanlış parolayla onun
    Homunculus girişini sürekli 429'da tutabilir (eşik en az 7 iken Windows oturumunu
    kilitlemez); yönetici kilidi dizi başına yalnız bir kez açabilir. İkisi runbook'un AD
    bölümünde de yazılı ("What the limits give away").
