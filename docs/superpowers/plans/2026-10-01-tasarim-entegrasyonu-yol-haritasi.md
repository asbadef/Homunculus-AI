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
| G1-01 | nginx: eksik API yolları + yapılandırma testi | 1 | Düşük | — | ✅ 01.10 · a638151 |
| G1-02 | main → LDAP birleştirme: 9 çakışma, göç `0010`, `clinical.chart` + `scores.sign` izinleri, kapsam izinlere, `infinity_research` `devices.manage`, demo kabuğu LDAP sürümü; bütün testler yeşil · plan: [dalga 0](2026-10-01-g1-dalga0-main-ldap-birlestirme.md) | 13 | **Yüksek** | G1-01 | ✅ 02.10 · 61d257a…c094b64 |
| G1-03 | LDAP arka ucu · dizin modülü + AD girişi + yenilemede dizin kontrolü (spec §7, §4) | 5 | Orta | G1-02 | Bekliyor |
| G1-04 | LDAP arka ucu · `/admin/ldap/*` içe aktarma, grup eşlemesi, yerel yönetici koruması | 5 | Orta | G1-03 | Bekliyor |
| G1-05 | Tasarım temeli: Gece/Gün renk değişkenleri, fontlar (yerel paket), ikonlar, temel bileşenler — `dashboard/src/live/` · plan: [dalga 1B](2026-10-03-g1-dalga1b-tasarim-temeli.md) | 5 | Düşük | G1-02 | ✅ 03.10 · 9d130be…f426b54 |
| G1-06 | Dört dil çatısı (anahtarlı sözlük, D2 varsayılanı) · plan: [dalga 1B](2026-10-03-g1-dalga1b-tasarim-temeli.md) | 3 | Düşük | G1-05 | ✅ 03.10 · 9d130be…f426b54 |
| G1-07 | Kabuk: sol menü (izinle), üst çubuk (birim çipi, saat, nöbet bitimine, dil, tema, zil, kişi menüsü); canlı mod yeni kabuğa | 5 | Orta | G1-05, G1-06 | Bekliyor |
| G1-08 | Giriş + 2FA + (D4'e göre) ilk girişte şifre, kilit ekranı | 5 | Orta | G1-07 | Bekliyor |
| G1-09 | Yataklar: kart/liste, risk sırası, dikkat kartları, birim filtresi, kapsam açıklaması | 5 | Orta | G1-07 | Bekliyor |
| G1-10 | Alarmlar: yanıt bekliyor / değerlendiriliyor / kapanan, Gördüm, eskalasyon hapları, sunucu saatiyle süre | 3 | Düşük | G1-07 | Bekliyor |
| G1-11 | Hasta ekranı · Özet: başlık, vital çubuğu, öneri kartı (gerekçe + kaynak), salt okunur | 5 | Orta | G1-09 | Bekliyor |
| G1-12 | Yönetim · Kullanıcılar (D3) + birimler (kapsam matrisi) | 5 | Orta | G1-07 | Bekliyor |
| G1-13 | Yönetim · Roller ve yetkiler (grup × izin matrisi) | 3 | Düşük | G1-12 | Bekliyor |
| G1-14 | Yönetim · Sistem ayarları › Giriş kaynağı (AD durumu, bağlantı testi, ara + içe aktar, grup eşlemesi) | 5 | Orta | G1-04, G1-12 | Bekliyor |
| G1-16 | Demo ve eski modları kaldır (`ClinicalDemo.jsx`, `clinicalDemo.js`, replay, legacy board, `?demo` PWA başlangıcı) | 3 | Orta | G1-09…G1-14 | Bekliyor |
| G1-15 | Uçtan uca doğrulama (yerel yığın, 4 dil, 390 px/1440 px) + VM deploy notları · temel: [RBAC planı](2026-09-23-rbac-groups-permissions.md), "Deploy notes for the VM" (zorunlu MFA kaydı: Sistem Yöneticisi, Sorumlu Hekim, Ünite Hekimi, Üretici Destek ilk girişte TOTP kurar; `0010` ön kontrolü) | 3 | Orta | hepsi | Bekliyor |

Dalga 0 sonu: backend 1665 geçti / 1 atlandı / 0 hata; dashboard 810 geçti (43 dosya); vite build tamam.
Kapanış düzeltmeleriyle (`f5abde8` test hesabı tohumu, `1e7b11b` iki metin): backend 1670 geçti /
1 atlandı / 0 hata; dashboard 810 geçti (43 dosya).

> G1-15'teki VM deploy kullanıcının kararıdır (aşağıda "Kullanıcı kararları", 2–3):
> yedek → `0010` ön kontrolü → göç `0008 → 0009 → 0010` → herkes bir kez yeniden girer.

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

- `/scope/me` panoyla aynı kararı verir: `enforce_unassigned` ve break-glass dahil
  (bugün `scope/router.py:66-71` ikisini de `build_scope`'a geçirmiyor).

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
- Arayüzde build SHA (`__BUILD_SHA__`) → G1-07
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
- admissionScreen · Daraltılmış sol menüde her madde kısa adıyla görünür, yalnız ikon kalmaz. → G1-07
- admissionScreen · Kabul formu yaşı doğum tarihinden hesaplar ve elle değiştirtmez; zorunlu alan eksikken düğme kapalıdır ve eksiği adıyla söyler. → Grup 2
- admissionScreen · Kabul onaylanınca doğum tarihi kayda düşer, protokol numarası ve yazdırılabilir barkodlu etiket çıkar; onaydan önce barkod uydurulmaz. → Grup 2
- biomedicalAccess · "Cihaz & Veri Akışı" sayfasına biyomedikal ve hastane yöneticisi ulaşır, hekim ve hemşire ulaşmaz; yalnız `devices.manage` taşıyan kullanıcı bugün canlı arayüze hiç giremiyor (`NO_BOARD_ACCESS`), sayfa gelince giriş kuralı da değişmeli. → Grup 4
- biomedicalAccess · Cihaz sayfası önce "veri geliyor mu" sorusunu yanıtlar (sessiz yatak, bayat kanal, veri akışı), sonra cihaz envanterini gösterir. → Grup 4
- escalationClock · Canlıda alarm ve eskalasyon süresi gerçek zamanla ilerler; simülasyonun 60× hızı uygulanmaz. → G1-10
- escalationClock · Süre biçimi: bir saatin altında `d:ss`, üstünde `s:dd:ss` (318:30 yazılmaz), negatif süre `0:00`. → G1-10
- loginRemember · "Beni hatırla" yalnız kullanıcı adını/e-postayı saklar, şifre ya da PIN'i asla; işaret kaldırılınca silinir; hatırlanan ad oturum açmaz, giriş ekranı yine gelir. → G1-08
- news2Honesty, news2Source · Kartta tek NEWS2 vardır, motorunki: motor göndermezse sayı yerine "—" ve nedeni (motor göndermedi) görünür; tarayıcı kendi NEWS2'sini (OAB'li yerel hesap) canlıda hiç göstermez. → G1-09
- news2Honesty · Eksik vitalle hesaplanmış kısmi NEWS2 kartta işaretlenir (kısmi skor yalnız düşük gösterebilir). → G1-09
- patientBaseline · Hastaya özel alarm aralığı motora gider (`PUT /clinical/{id}/profile` · `baselines`); girilmeyen parametre gönderilmez (boş ≠ sıfır), ters aralık gönderilmeden reddedilir, kutu bunun cihaz alarmı olmadığını söyler. → Grup 2
- pharmacyView · Eczacının kendi sayfası vardır (antibiyotik saati, doz önermez, "kayıt yok"u "verilmedi" diye göstermez); eczacı ve sorumlu hekim görür, hemşire görmez. → Grup 3
- rrtPage · RRT ekranı menüdedir: hızlı yanıt ekibi ve yönetici görür, hemşire görmez. → Grup 2
- rrtPage · RRT ekranı kendisine eskale edilen alarmları (elle çağrıldıysa yazılı) ve yoldaki cevapsız alarmları ayrı gösterir; liste boşsa boş durumu, 3. kademe kapalıysa bunu açıkça yazar. → Grup 2
- rrtPage · Menü rozeti cevapsız eskalasyon sayısını gösterir; cevaplanan alarm rozetten düşer. → Grup 2
- setupWizardScope · Canlı kurulumda yönetici kurulum sihirbazına düşmez (kiracı deploy'da kurulur), doğrudan ürüne, Sistem Ayarları'na ve cihaz sayfasına ulaşır; diğer roller de doğrudan girer. → G1-07
- simulationGating · Canlıda simülasyon denetimleri (alarm üret, saat hızı 30×/60×/120×, duraklat, "sonuç simüle et", DEMO etiketi) hiç çizilmez; mod belirtilmezse varsayılan canlıdır. → G1-16
- simulationGating · Break-glass canlıda kalır: araç değil, gerçek klinik denetim. → Grup 2
- simulationGating · Canlı Sonuçlar sayfası gerçek bekleyen sayısını ve elle yüklemeyi korur. → Grup 3
- simulationGating · Dil algılama bugün İngilizce yerel ayarda TR, Azerbaycanca cihazda AZ açar, seçilen dil kazanır (testleri `i18n.rbac.test.js`'te); D2 ile varsayılan AZ olunca bu testler birlikte değişir. → G1-06 ✅ Yeni kabukta `src/live/i18n/I18nProvider.test.jsx` (AZ varsayılan, algılama yok, saklanan seçim kazanır); `i18n.rbac.test.js`'teki eski vakalar eski çalışma alanını G1-16'ya kadar korur.
- clinicalCharting (silinen vakalar) · Vazopressör/inotrop dozu (noradrenalin, adrenalin, dopamin, dobutamin; yazım farkı önemsiz) motora hız kodu olarak gider; puanlanmayan ilaç sinyal diye uydurulmaz. → Grup 3
- clinicalCharting (silinen vakalar) · Verilen sıvı (yalnız giriş) motora `crystalloid_bolus_ml` olarak gider; çıkış gönderilmez. → Grup 3
- clinicalCharting (silinen vakalar) · Kabulde kilo `weight_kg` gözlemi, serbest metin eşlik eden hastalıklar ("DM, HT; KOAH") hasta profili olarak motora gider; boş kutu profil göndermez, yan kanal hatası kabulü geri almaz. → Grup 2
- scopeAssignment (silinen vakalar) · Kapsam matrisi (birim + yatak) `PUT /scope/{user}` ile motora yazılır, tek hücre tıklaması da aynı yoldan gider; motor reddederse ekrandaki matris geri alınır. → G1-12

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
- İzin açıklamaları güncel değil: `users.manage` kapsam atamayı, `devices.manage` canlı değerleri ve satıcı grubunu söylemiyor. → G1-13
- Kısmi NEWS2 ipucu ve `NEWS2_MISSING_LABEL` yalnız Türkçe. → G1-06 ✅ Dört dilde `src/live/i18n/strings/news2.js`; karta G1-09 bağlar.
- `patientFromBoard` `identity.bed_id`/`unit_id`'yi okumuyor: her HBYS hastası "yatak bekliyor" görünür; birim filtresi ve kapsam matrisi için gerekli. → G1-09
- `auditRowFromRecord` kişi alanını `actor`'dan okumuyor (ack ve `scope_denied` satırları "—"); test fikstürü backend'in göndermediği `{by}` biçimini kullanıyor. → Grup 2
- Vite dev proxy'de `/admin`, `/scope`, `/scores`, `/infinity-research` yok (`/clinical` ve `/alarm-quality` var; yalnız `npm run dev`'i etkiler). → G1-07
- `main.jsx`'te ölü `simulation` prop'u; PWA manifest `start_url: "/?demo=1"`. → G1-16
- `backendApi.myScope()` kullanılmıyor. → G1-12
- `?infinityTest=1` yalnız ana çalışma ağacındaki commit'lenmemiş değişiklikte var. → kullanıcıya not
- `clinicalDemo.js:475`'teki demo yönetici parolası git geçmişinde; gerçek bir yerde kullanıldıysa değiştirilmeli. → kullanıcıya not
- `homunculus-ml/**/__pycache__/*.pyc` takipte (`324d2bd`'den beri). → ayrı temizlik
- `scripts/dev_local.py` SQLite'ta hâlâ tamamlanmaz: `seed_bootstrap` Postgres'e özgü kilit alıyor (`pg_advisory_xact_lock`), varsayılan yönetici parolası `Demo1234!` 12 karakter kuralına takılıyor, venv'de `aiosqlite` yok. → ayrı küçük iş

## Dalga 1B'den açık kalanlar

- Giriş kutusu kenarı (`--line2`) kart/card2'de 1,4–1,6:1 (WCAG 3:1); odakta `--pri` olur.
  → "Kullanıcı kararları", 10.
- Prototip dışı yeni metinler (`risk.none/unmeasured/unknown/unreported`, `news2.*`, galerinin çoğu)
  ve AZ "düşük" etiketi `Aşağı` (prototipte cihaz önceliğiydi, risk düzeyi olarak okunmalı)
  AZ/RU/EN'de anadili konuşan bir klinisyenin okumasını bekliyor → pilot öncesi.
- Prototipin Gün temasında monitör paneli (`--monbg`) üzerindeki vital renkleri 1,2–3,8:1; `--monbg` taşınmadı → Grup 2 monitörü taşırken düzeltir.
- Otomatik tema (20:00–08:00) yalnız mobil prototipte vardı; web için ertelendi → G1-07 ya da sonrası.
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
  bir sekmede değişince öbürü eskisinde kalır → G1-07.
- Ekran okuyucu risk hapında yalnız düzeyi okur ("Orta"); görünmez "Risk:" öneki → G1-09.
- Pencere açıkken bildirime (toast) klavyeyle ulaşılamaz: pencere Tab'ı içinde tutar.
  Fareyle kapanır; yığın o sırada sağ üste çıkar (sağ altta altbilgiyi örtüyordu,
  390×380) → G1-10.
- `Field` hatası canlı bölge değil: gönderimde çağıran ilk geçersiz alana odaklanır,
  ekran okuyucu hatayı alanla birlikte okur → G1-08/G1-12 formları.
- Meşgul `Button` ekran okuyucuda yalnız "kullanılamaz" okunur; görünmez bir
  "kaydediliyor…" metni düşünülmeli → G1-10, ilk kullanımda.
- `ThemeProvider` sökülünce `<html>` özniteliklerini önceki değerlerine döndürmez,
  siler; `I18nProvider` `<html lang>`'ı bırakır → G1-07.
- Tutarlılık notu: `StatusPill`/`Tag` bilinmeyen tonu nötre düşürür; `riskStyle` ise
  bilinmeyen riski dikkat görünümüne çeker. Çağıranlar yalnız bilinen tonu geçer.

## Kullanıcı kararları (Dalga 0 sonrası)

Öncelik sırasıyla:

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
