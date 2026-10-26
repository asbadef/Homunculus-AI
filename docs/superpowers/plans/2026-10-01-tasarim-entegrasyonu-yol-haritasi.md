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
| **2** | ICU vital diyagramları (önce) + hazır uçların ekranları: yapı/doluluk, birim kapsamı, devir, kabul/transfer/taburcu, denetim, alarm ertele/eskale | Kısmen — vital geçmişi: `GET /patients/{id}/trends` (G2 · dilim 1) |
| **3** | Klinik iş akışları: Görevlerim, formlar, yatak başı ölçüm, bakım planı, ilaç, sıvı, sonuçlar, belgeler, eczane, RRT | Yok |
| **4** | Yönetim/operasyon: yönetici özeti, kalite, enfeksiyon, pilot, iş yükü, cihaz bakımı, kamera, Y1–Y7, bildirim kuralları, bakım kataloğu | Yok |
| **5** | Tanıtım sayfası + mobil (tasarımcının yereldeki Expo commit'leri önce GitHub'a) | — |

**Grup 2 vital diyagramlarında eşik kuralı:** bant/eşik yalnız üç kaynaktan gelir: cihazın
kendi alarm limiti (Infinity kaydı), NEWS2 bantları (kasa), hekimin girdiği hastaya özel normal.
Prototipteki sabit sayılar (`core.js:499` `H.VITAL.al/nb`) kaynaksızdır, taşınmaz.

**Grup 2 · durum**

| # | İş | Durum |
|---|---|---|
| G2-01 | Vital eğrileri (hasta ekranı): altı kart, büyük grafik (6 sa / 24 sa / 3 gün, tablo), hastanın normali formu; `GET /patients/{id}/trends` · spec: [2026-10-19](../specs/2026-10-19-g2-vital-egrileri-design.md) · plan: [G2 dilim 1](2026-10-19-g2-vital-egrileri.md) | Kod ✅ 2026-10-21 · ec8678a..74380a1 · **VM'de ✅ 21.10** (api+web+köprü `6407492`; köprü imajı VM'de kuruldu — ghcr jetonu geçersiz; göç yok; geri dönüş etiketleri `:a2c1257`; gölge hattı kontrolü KABUL; web `0ea1d05` ile 21.10 akşamı yenilendi: monitör şeridinin `sr-only` hücreleri konumlu üst öğe bulamayınca belgeyi kabuğun altına uzatıyordu, kaydırıcı ve şerit artık `relative`). Backend 2143 / 650 (DB'siz), 2785 / 8 (Postgres), Python 3.14 dilimi 366; dashboard 89 dosya / 2391 test; 72 sa penceresi p50 ≈ 4 ms, en kötü 29–50 ms (yedi koşu; bir gen-2 çöp toplama duraklaması, sunucu da öder; sınır 300 ms). Yerel yürüyüş 2026-10-21 (g2v yığını, sentetik hesaplar, başsız Chrome): adım 7 motorun beklenen yanıtıyla satır satır aynı; adım 8'in bütün maddeleri geçti — altı kart ve çerçeveler motorun puanı, tablo = grafik, form yazıyor ve bant çıkıyor, temizleme `restart api` sonrası da geri gelmiyor, 390 / 1440 px, dört dil, iki tema, ham anahtar yok. **Kullanıcıda:** NVDA (grafikte odak kipi, her harekette bir okuma, tablo gözatma kipinde satır eklenirken), NVDA'nın grafik adını sayı değişince yeniden okuyup okumadığı (O25), MAP'in içi boş halkası noktadan ayrılıyor mu, 72 sa saat etiketleri `--fs` 1.12'de; göz kararları: değerler mürekkep renginde (X24), iki serili mini grafikte bant yok (X26), Gece'de 3 puan bandı 1–2 puan bandından sessiz, Gün'de diyalogdaki ızgara çizgileri silik; VM'de bakış (gerçek bir hasta, değerler yazılmaz). **Kararlar (21.10, VM'den önce):** X21/O12 — kayıt bildirimi düzeltildi: "<yatak>: hastanın normali kaydedildi; sonraki ölçüm bu aralıklarla değerlendirilecek" (`cefbf58`); motorun kayıtta yeniden yargılaması sonraya; O15 — böyle kalır (her clinical.chart sahibi); O17 — ayrı dilim, deploy'dan sonra; O21 — eklendi: okuma NEWS2 puanını söyler (`8f1ba57`); O3 — pilotta kabul. **Dağıtım:** köprüler hub'dan önce ya da birlikte (3b; köprü tamponlarında sonlu olmayan satır var mı bakılır); pano asla tek başına (temizleme 14a'yı ister). **Açık:** az/ru yerel okuma; plandaki X20–X35 (X35: kartın farkı bir önceki *ölçüme* göre, bir önceki satıra değil — köprü aynı ölçümü iki kez teslim edebilir) ve O1–O3, O6–O12, O14, O15, O17–O25 (X1–X19 onaylandı, O4 çözüldü: 2026-10-20) |
| A-NBP | Aşama A şeridinde NBP, değerinin son değiştiği saatle ("ölçüm ≤ SS:DD (N dk)"; üst sınır, hub saatine göre gerçeğinden en çok 3 sn yeni; hub başlangıcından sonra, ya da değer bir kesinti ya da tam geçerli üçlüler arasında 3 sn'den uzun bir boşluk sırasında değiştiyse, değeri değiştiren bir sonraki ölçüme kadar gizli; değişimden 2 sa sonra gizli — API 15 sn erken keser ki hiçbir ekranda 2 saati geçmesin) · hub R4 `transport-eeba1f4702719919` + drop-in 94, şema `homunculus.infinity-shadow.v2` · spec: [2026-10-22](../specs/2026-10-22-infinity-nbp-degisim-saati-design.md) · plan: [NBP](2026-10-22-infinity-nbp-degisim-saati.md) | Kod ✅ `feat/infinity-nbp` · backend 2195 / 650 (DB'siz), dashboard 89 dosya / 2413 test · **VM'de ✅ 25.10** (api+web f72dafa 07:57 UTC, hub R4 + drop-in 94 08:00 UTC; geri dönüş etiketleri `:pre-nbp`; gölge ve taşıma kontrolleri KABUL; PANO_OZET değişmedi; O30: tam üçlüler arasında düzenli 3,0 sn boşluk, karar: olduğu gibi, genişletme O38) · **Kararlar:** X37–X45 kullanıcı onayladı (25.10), X46 (sıkı süreklilik, Görev 1 incelemesi), X47 (tarayıcıda eşik koruması NBP'nin parçalarına ve yaşlarına genişledi, Görev 5 incelemesi), X48–X49 (açıklama metni: kesinti ve üst sınır, Görev 7 incelemesi), X50 (API 2 sa − 15 sn'de keser, son inceleme) · **Açık:** O27–O37 |
| G2-A1 | Alarm bölümleri (O17): bir alarm, kuralı onu üretmeyi bıraktığı ilk ölçümde kapanır; kimsenin onaylamadığı kritik alarm «geçti · onaylanmadı» olarak onaylanana kadar kalır, sesi durur; yeniden çıkan alarm yeni bir bölümdür (yeni ilk görülme, eskalasyon saati, hemşire bildirimi ve ▲); `alert_cleared` denetim olayı; yeniden başlatma panoyu bölüm bölüm kurar · spec: [2026-10-25](../specs/2026-10-25-g2a-alarm-bolumleri-design.md) · plan: [G2-A1](2026-10-25-g2a-alarm-bolumleri.md) | Kod ✅ 2026-10-25 · 39812b6..7251540 · **VM'de değil** (kabul kullanıcıyla, ayrı adım: spec §6; web api'den sonra değil — eski web, kilitli kalan bir kritiği hâlâ çalıyormuş gibi seslendirir). Backend 2220 / 650 (DB'siz), Python 3.14 dilimi 179; dashboard 89 dosya / 2411 test; derleme 20 öğe. Kabul (spec §6'nın dört adımı) geliştirme sunucusunda (X11) geçti — SQLite denetim, gerçek yeniden başlatma, sentetik yataklar; Docker yığını çalıştırılmadı. **Açık:** plandaki X1–X14 (X9: antibiyotik saatinin başlangıç anı yalnız şüpheli enfeksiyon «yok» diye kaydedilince bırakılır, antibiyotik alarmları yalnız sepsis ya da septik şok sürerken görünür — kullanıcı kararı 25.10; X10: «geçti · onaylanmadı» rozeti yalnız alarm ekranında değil, yatak kartında, yatak listesinde, zilde ve hasta ekranında da; X11: kabul geliştirme sunucusunda; X12: «yok» işareti 15 dakika içinde düzeltilirse eski antibiyotik penceresi geri gelir; X13: kimsenin yanıtlamadığı bir alarm eskalasyon süresi içinde dönerse aynı eskalasyon zinciridir, onay zinciri bitirir; X14: doktor zincir başına bir kez çağrılır) ve O1–O15 (O15: saatlerce yanıtsız kalan bir alarm için yinelenen çağrı yok — sonraki dilimde kullanıcı kararı); az/ru/en metinleri yerel okuma bekliyor |
| G2-A2 | Motor borcu: NEWS2 tazeliği — penceresini aşan ölçüm (vital 1 sa, ateş 2 sa) skora girmez, skor kısmi olur, kart hangi girdinin ne kadar eski olduğunu yazar, pencere kapanınca pano yeniden gönderilir; kaydedilmemiş oksijen ve bilinç «varsayıldı» diye işaretlenir (kısmi sayılmaz; kayıt 8 sa geçerli; süresi dolan kaydın son değeri hapta yazar); alarm da aynı skoru kullanır ve çalışan bir NEWS2 alarmını eski girdi bitiremez (tutulur, yalnız aşağı iner, girdi eskidikten en geç 8 sa sonra biter); bir okuma hiçbir kapıda duvar saatinden ileride değerlendirilmez, yeniden başlatmada da; denetim okumaları en yeni satırlardan (`/audit` en çok 1000, `/alarm-quality` penceresini veritabanına sorar ve `truncated` der), yeniden başlatma her satırı sayfa sayfa okur ve yalnız bitince kurulur; okunamayan kapsam 503 (sahte `scope_denied` satırı yok); `/ingest` hasta kimliği tek kural (kırpılır, boş olamaz, en çok 128, aksi 400) · spec: [2026-10-25](../specs/2026-10-25-g2a-motor-borcu-design.md) · plan: [G2-A2](2026-10-25-g2a-motor-borcu.md) | Kod ✅ 2026-10-26 · 8c726fd..64271db · **VM'de değil** (spec §7: grubun kapısı ve sahibin Q2/D6/D8 onayı; api ve web aynı sürümde, web tek başına geri alınmaz; göç yok; ilk açılışta tenant'ın ilk isteği tüm denetim kaydının yeniden oynatılmasını bekler — VM'de önce satırlar sayılır; VM'den önce O17). Backend 2390 / 654 (DB'siz), Postgres denetim ve kimlik testleri 54; Python 3.14 dilimi 363 (13 test dosyası); dashboard 89 dosya / 2441 test; derleme 20 öğe. Kabul (spec §6.1, 6.2, 6.3, 6.5) `64271db`'nin geliştirme sunucusunda geçti — SQLite denetim, gerçek yeniden başlatma (5214 satır, iki sayfa; pano aynı), sentetik yataklar, iki itme pencere kapandıktan 9 sn sonra; §6.4 (okunamayan kapsam) ve tarayıcı yürüyüşü Docker yığınında kullanıcıyla. **Açık:** X1–X12 (plandaki X1–X8 ve incelemelerde bulunanlar — X1: kısmi notu eski girdiyi de sayar; X2: kartın tamamı tek anda, antibiyotik saati ve eskalasyon yayını dahil; X3: sekizinci metin `assumedLast`; X4: kart saati üç ekrandan alır; X5: `patient_identity.py`'de içe aktarma satırı da; X6: rehberde kapsam cümlesi; X7: kabulün §6.4'ü Docker yığınında kullanıcıyla; X8: en yeni N bellekte sayıyla kesilir, sınırlar 1'den; X9: eski girdi çalışan NEWS2 alarmını bitiremez; X9b: tutulan alarm eski değerle yükselmez; X9c: eski değerler son hâlleriyle bile bandın altına inince biter; X9d: eski değerlerin ulaştığı alt banda iner, hiç çıkmaz; X9e: NEWS2 hasta başına geri gitmeyen bir anda değerlendirilir; X10: kapılar okumayı min(damga, duvar saati) anında değerlendirir; X10b: yeniden başlatma min(damga, satırın yazıldığı an) anında; X11: süresi dolan oksijen/ACVPU kaydı alarmı eski vital gibi tutar, hap son değeri yazar; X12: tutma, girdi eskidikten en çok 8 sa sürer) ve O1–O21 (O2: Q2/D6/D8 VM'den önce sahibin onayı; O5: `/ingest`'in hasta kimliği dışındaki bozuk alanları hâlâ 500; O17: reddedilen bir gözlem köprüyü durdurabilir — VM'den önce; O20: tutulan alarm kartta ve alarm listesinde işaretsiz; O21: yeniden başlatmadan sonra çalışan acil alarm hemşireye bir kez daha bildirilir); az/ru/en metinleri yerel okuma bekliyor |

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
| D1 | Eski simülasyon demosu (`?demo=1`) | ✅ 01.10 | **Kaldırılır.** Yeni kabuk canlı store'u demo store'a dayanmadan kurar; `ClinicalDemo.jsx`, `clinicalDemo.js`, `?mode=replay`, `?board=1` Grup 1 sonunda silinir (G1-16). Vercel'deki genel demo da kalkar (yayından kaldırma kullanıcının işi). ✅ **G1-16 (`ab6dead`…`8574bbb`):** simülasyon, önceki canlı arayüz, replay ve eski pano koddan çıktı; eski adresleri canlı sistemi açar ve adres çubuğundan silinir. Vercel'deki yayın hâlâ kullanıcının işi |
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

**G1-16'da kullanıcının verdiği kararlar (13.10.2026; [G1-16 planı](2026-10-13-g1-16-eski-modlari-kaldir.md)):**

18. **Sesli alarm ve kritik alarm bildirimi:** ✅ **eski çalışma alanı silinmeden ve VM
    deploy'undan önce yeni arayüze taşınır.** Taşındı (`999b1c9`, `a6ddabb`, `src/live/signals/`),
    eski kod ondan sonra silindi (`2ba255c`). Gerçek bir hoparlörde ve Windows bildiriminde
    denenmesi G1-15 kapısında.
19. **Kritik alarm bildiriminin metni:** ✅ **eski derlemedeki gibi kalır** — uygulama açıkken
    alarmın yatak etiketi, etiket yoksa hasta kimliği; uygulama kilitliyken hiçbir şey
    adlandırmaz ("Cavab gözləyən kritik siqnal var…", `signals.notifyBodyLocked`).
20. **Sayfadan erişilemeyen 13 modül:** ✅ **silinir**, Grup 2–4 için başvuru olarak tutulmaz; git
    geçmişi saklar (`e4cdf15`; silme `ab6dead`).

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
| G1-09 | Yataklar: kart/liste, risk sırası, dikkat kartları, birim filtresi, kapsam açıklaması · plan: [dalga 3](2026-10-08-g1-dalga3-is-ekranlari.md) | 5 | Orta | G1-07 | ✅ 11.10 · ortak temel (Görev 0–8) 5a76853…266f52f, inceleme düzeltmeleri 39d4337; kart bdd5e0e, sıra ve süzgeçler 32d0ce9, ekran c23d002; üç ekranın ortak sembolleri 7acd78b; inceleme a326421, 28e6722. "`red_param` kartı en az amber yapar" ölçütü bilerek karşılanmadı (aşağıda kabul ölçütleri). Tarayıcıda bakış kayıtlı değil → G1-15 |
| G1-10 | Alarmlar: yanıt bekliyor / değerlendiriliyor / kapanan, Gördüm, eskalasyon hapları, sunucu saatiyle süre · plan: [dalga 3](2026-10-08-g1-dalga3-is-ekranlari.md) | 3 | Düşük | G1-07 | ✅ 11.10 · ekran 29b158c, menüdeki sayaç ve zilin satır bağlantıları 0a698a3 (birleşme 3a8d589); inceleme 450507d, a0d9402, 4791442, f4d6449. "Kapanan" bölümü yok: geçmiş için uç yok, ekran bunu söylüyor. Tarayıcıda bakış kayıtlı değil → G1-15 |
| G1-11 | Hasta ekranı · Özet: başlık, vital çubuğu, öneri kartı (gerekçe + kaynak), salt okunur · plan: [dalga 3](2026-10-08-g1-dalga3-is-ekranlari.md) | 5 | Orta | G1-09 | ✅ 11.10 · menüde `under` 41a2b83, dört dil c42ad07, ekran c5f6cb6, şüpheli enfeksiyon işaretleme 420bbbe; inceleme 40fd08a, 0a4f754, 36f7860, 4791442, f4d6449. Salt okunur değil: tek yazdığı şüpheli enfeksiyon işareti (kullanıcı kararı); SOFA formu ve hastanın kendi normali → Grup 2. Tarayıcıda bakış kayıtlı değil → G1-15 |
| G1-12 | Yönetim · Kullanıcılar (D3) + birimler (kapsam matrisi) · plan: [dalga 3B](2026-10-12-g1-dalga3b-yonetim-ekranlari.md) | 5 | Orta | G1-07 | ✅ 13.10 · temel (Görev 0–4) 5fdc5cd…34494a8; Görev 5–7 b10179d, 6bc6740, 95adfa6, inceleme turları 9f49cb3 + baa1780; Görev 14 fa8c522 (`/scope/me` panoyla aynı karar) + 65d6a36 (14e); son bütün-dalga incelemesi d9bb996 (kapsam kaydı sayacı yeniden okur) + a301c73 (`PUT /scope` karşılaştır-ve-değiştir). Kapsam "matrisi" liste olarak (Karar 7, aşağıda kabul ölçütleri). Tarayıcıda 390/1440 px bakışı kullanıcıda |
| G1-13 | Yönetim · Roller ve yetkiler (grup × izin matrisi) · plan: [dalga 3B](2026-10-12-g1-dalga3b-yonetim-ekranlari.md) | 3 | Düşük | G1-12 | ✅ 13.10 · Görev 8–9 05c7e7a, 1eb7356, inceleme turları fedde5b + 2ab1f10; 409 yolunu canlı yapan sunucu karşılaştırması Görev 14e 65d6a36. Tarayıcıda bakış kullanıcıda |
| G1-14 | Yönetim · Sistem ayarları › Giriş kaynağı (AD durumu, bağlantı testi, ara + içe aktar, grup eşlemesi) · plan: [dalga 3B](2026-10-12-g1-dalga3b-yonetim-ekranlari.md) | 5 | Orta | G1-04, G1-12 | ✅ 13.10 (kod ve testler) · Görev 10–11 a6de6b2, 96c37ee, inceleme turları 6e8f6c9, 5fd309d, a06fc3c; son bütün-dalga incelemesi d9bb996 (eşleme silmek çerçevenin listelerini yeniden okur). Bağlantı testinin beş gerçek nedeni hastanenin etki alanı denetleyicisi olmadan denenemez (yalnız taklitle test edildi) → G1-15 kapısı |
| G1-16 | Demo ve eski modları kaldır (`ClinicalDemo.jsx`, `clinicalDemo.js`, `liveStore.js`, `clinicalI18n.js`, `legacyRoots.jsx`, replay, legacy board, `?eski=1` önceki canlı arayüz — kilidi bilmez, G1-15'ten önce gitmeli); PWA `?demo` başlangıcı Dalga 2'de düzeltildi · plan: [G1-16](2026-10-13-g1-16-eski-modlari-kaldir.md) | 3 | Orta | G1-09…G1-14 | Kod ✅ 13.10 · `ab6dead`…`8574bbb`. 80 dosya silindi (75 kaynak + 5 replay JSON'u, ~29 bin satır): sayfadan erişilemeyen 13 modül (`ab6dead`; Grup 2–4 hedefleri, aşağıda "G1-16'da silinenler"), replay ve eski pano (`8c0ed89`), simülasyon ve önceki canlı arayüz (`2ba255c`). `?demo=1`, `#/demo`, `?eski=1`, `?mode=replay`, `?scenario=`, `?board=1` canlı sistemi açar; parametre adresten silinir (`main.jsx` `withoutRetired`). `src/` altında sayfanın erişemediği modül kalmaz (`reachable.test.js`). Silmeden önce eski çalışma alanının **sesli alarmı ve arka plandaki kritik alarm bildirimi** yeni arayüze taşındı (`999b1c9`, `a6ddabb`; kullanıcı kararı 18, 13.10): kilitte de çalar, oturum bitince durur, ayarı Ayarlar › "Ses ve bildirim"de; Görev 1–5 incelemesinin düzeltmeleri `cf1aa7c`, `7168ac6`. Dashboard 75 dosya / 1804 test; 500 kB uyarısı yok; önbellek 20 kayıt. Planın Görev 10'u (son doğrulama) 13.10'da yapıldı: test takımı iki kez 1804/1804, build bütçe içinde, aramalar temiz. **Açık:** tarayıcıda bakış — eski adresler, Ayarlar sekmesi, gerçek hoparlör, Windows bildirimi (G1-15 kapısı) |
| G1-15 | Uçtan uca doğrulama (yerel yığın, 4 dil, 390 px/1440 px; Dalga 3'ün koşulmamış Görev 24'ü buraya katlandı, aşağıda) + VM deploy notları · temel: [RBAC planı](2026-09-23-rbac-groups-permissions.md), "Deploy notes for the VM" (zorunlu MFA kaydı: Sistem Yöneticisi, Sorumlu Hekim, Ünite Hekimi, Üretici Destek ilk girişte TOTP kurar; `0010` ön kontrolü) · plan: [G1-15](2026-10-14-g1-15-uctan-uca-ve-vm.md) | 3 | Orta | hepsi | Part A (yerel kapı) ✅ 14.10 · `86117d6`'da (F1–F3 birleşmiş: `d1d0a74`, `835d739`, `86117d6`; F4 ölçüldü): yığın kuruldu ve `0011`'de sağlıklı, 37/37 duman denetimi (28 + F1'in 9'u), VM'nin `538ba54`'ünden yükseltme provası ve geri dönüşü, dashboard 1809/1809 ve sabitli 1787/1787, build bütçe içinde, backend 3.12 ve 3.14'te 2304 / 8; makine bulunduğu gibi bırakıldı. Sonuç aşağıda "G1-15 kapısı — Part A sonucu". **Açık:** Part C (VM deploy, yalnız kullanıcıyla), Part B (tarayıcıda yürüyüş — kullanıcı kararı 14.10: sentetik veriyle yerelde değil, deploy'dan sonra VM'de gerçek yataklarla, kullanıcıyla birlikte), A8 (takım API imajının içinde) ve kişi gerektiren maddeler (B10/B11 okumaları, servis duyurusu, hastanenin yanıtları) |

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

Dalga 3 sonu (G1-09/G1-10/G1-11; `5a76853…91dbd05`, son kod commit'i `f4d6449`, `91dbd05` yalnız
tasarımcı notu): dashboard 2089 geçti (98 dosya); vite build tamam — Dalga 3B planının `91dbd05`'te
ölçtüğü taban ([dalga 3B planı](2026-10-12-g1-dalga3b-yonetim-ekranlari.md), "Counts"). Dalga 3
planının beklediği 99 dosya / 2097 test, yönetim temelinin (Görev 16–19) 3 dosya / 58 testini de
sayıyordu; o temel Dalga 3'te birleşmedi, Dalga 3B Görev 1'de `5fdc5cd` ile geldi. Dalga 3 arka uca
dokunmadı (`git diff 5a76853^ 91dbd05 -- homunculus-engine` boş). Ortak temel (Görev 0–8) ve üç
klinik ekran ayrı ayrı incelendi; bulguları yukarıdaki inceleme commit'lerinde. Ama
dalganın uçtan uca doğrulaması (Görev 24: tarayıcı, dört dil ekranda, 390/1440 px, yalnız klavye,
dört kasıtlı ret, motorun gerekçe metinlerinin okunması) **koşulmadı** — G1-15 kapısına katlandı
(aşağıda "(Dalga 3) Uçtan uca yürüyüş").

Dalga 3B sonu (G1-12/G1-13/G1-14, son kod commit'i `65d6a36`): dashboard 2413 geçti (108 dosya);
vite build tamam; backend Python 3.12'de 2294 geçti / 8 atlandı, 3.14'te 2298 geçti / 6 atlandı —
ikisinde de `tests/test_infinity_vm_pilot.py` hariç: yük altında asılı kalıyor (tek başına 8 s'de
geçiyor), düzeltmesi Grup 4. Her sekme iki ya da üç kez incelendi; her bulgu düzeltilmeden önce
başarısız bir testle kanıtlandı ve incelemecilerin mutantlarını testler yakaladı. Tarayıcıda
bakış (390/1440 px, iki tema) **yapılmadı**: kullanıcının işi, aşağıda "Dalga 3B'den açık kalanlar".

G1-16 sonu (son kod commit'i `7168ac6`; Görev 1–5 incelemesinin düzeltmeleri `cf1aa7c`,
`7168ac6`): dashboard 1804 geçti (75 dosya) — G1-16'nın tabanından (`69f059f` / `126a011`: 2430 /
108) 626 test ve 33 dosya eksik: silinen kodun 37 test dosyası gitti, 4 yeni geldi —
erişilebilirlik ağı (`reachable.test.js`) ve taşınan ses ve bildirimin 3 dosyası (taşıma 36,
incelemesi 22 test ekledi). Yeni arayüzün kendi testleri (`src/live/`) yalnız bu taşımayla 62
dosya / 1504'ten 65 / 1562'ye çıktı; hiçbir silme ondan bir şey almadı. Vite build tamam, 500 kB
uyarısı yok: ilk parça 146,74 kB / 48,02 kB gzip, `LiveApp` 206,66 kB / 63,90 kB, ortak parça
(`Toast`) 186,01 kB / 68,39 kB; servis çalışanı 20 kayıt / ~753 KiB (önce 22 / ~785).
Arka uçta yalnız üç yorum değişti (`tests/test_nginx_routes.py` 40 geçti, Python 3.14). Planın
Görev 10'u yapıldı (13.10): test takımı iki kez 1804/1804; build bütçe içinde (500 kB'ı geçen
parça yok, ilk parça ≤ 150 kB / ≤ 50 kB gzip, önbellek 20 kayıt, `dist`'te `legacyRoots`,
`browser` ve `demo` yok); kaldırılan bir modu hâlâ açık sanan bir satır yok (eski adresleri bilerek
anan dört dosya dışında); eski modüllerin adı yalnız on dosyada, hepsi test girdisi ya da kaynak
notu; dalın tabana göre farkı 127 dosya (80 silindi, 10 eklendi, 37 değişti). Tarayıcıda eski
adreslerin ve gerçek bir hoparlörün denenmesi kullanıcıda ve G1-15'te (yukarıda G1-15 kapısı;
G1-16 planı, "Needs the user").

**G1-15 kapısı — Part A sonucu (yerel kapı, 14.10, `86117d6`).** Plan:
[G1-15](2026-10-14-g1-15-uctan-uca-ve-vm.md), Part A (A0–A10). Kapı dalın ucunda koşuldu:
`86117d6`, F1–F3 birleşmiş (F1 `d1d0a74` compose `SCOPE_ENFORCE_UNASSIGNED`'ı API'ye geçirir; F2
`835d739` build SHA'sı Docker derlemesine ulaşır; F3 `86117d6` ortak anahtarlar testi derlemesini
söyler). Her sayı bu commit'te ölçüldü; VM'ye bağlanılmadı; bütün veriler sentetik (`TEST …`,
`yatak-0N`, `yb`/`yyb`).

- **A0 · taban:** uç `86117d6`, `git status` boş, yığın konteyneri yok; compose yapılandırması üç
  bağlama kaynağını karalamada, `127.0.0.1:18080/18443`'te gösteriyor; `SCOPE_ENFORCE_UNASSIGNED`
  (F1) ve `BUILD_SHA` (F2) yapılandırmada.
- **A1 · yığın:** iki imaj derlendi; `BUILD_SHA=86117d6` ile web imajında `index` 146,74 / 48,02 kB
  gzip, `Toast` 186,01 / 68,39, `LiveApp` 206,71 / 63,94, önbellek 20 kayıt (753,09 KiB). API
  sağlıklı, `0011`; on bir grup, MFA zorunlu dördü roadmap'inkiler (`attending`, `hospital_admin`,
  `platform_support`, `unit_physician`); tohum yönetici `local|t|f`; HTTP 200, HTTPS 200.
- **F2 denetimi:** Docker'da derlenmiş web imajının `LiveApp-CRKoRz8Y.js`'i `"86117d6"`'yı iki
  sabitte taşıyor (üst çubuk ve Ayarlar › Profil); `onrender.com` yok. Derleme `BUILD_SHA` ile
  yapılınca (C7) paket SHA'yı taşır; ekranda görülmesi Part B'nin işi (B7.3). A5 provasında aynı
  komutla derlenen web imajı da aynı SHA'yı taşıdı.
- **A2–A3:** 12 sentetik hesap, 11 grup, dört TOTP hesabı; altı yataklı sentetik koğuş: `yb`'de
  yatak-01..03, `yyb`'de 04..05, yatak-06 kimliksiz; riskler none / high / **critical** (news2,
  sepsis, antibiotic_due, under_resuscitated_sepsis, septic_shock) / high / none / high.
- **A4 · duman, nginx üzerinden: 37/37** — planın 28 denetimi ve F1'in 9 denetimi (`smoke.sh`'a
  eklendi). **F1 denetimi:** atanmamış hemşire, kapalıyken 6 yatak görür; env dosyasına
  `SCOPE_ENFORCE_UNASSIGNED=1` eklenip `up -d --no-build api` ile API yeniden kurulunca konteyner
  değeri taşır, nginx yeni API'ye ulaşır, hemşirenin `/scope/me`'si `('unassigned', False, [])`,
  panosu **0** yatak; yönetici değişmez (`('role', True)`); satır kaldırılıp API yeniden kurulunca
  değer boş, `/scope/me` `('unassigned', True)`, pano yine 6. `scope_denied` satırı **0**; API
  yeniden başlatıldıktan sonra pano 6 yatakla geri geldi. **Plandan sapma:** API durdurulduğunda
  nginx hemen 502 değil, **60 s sonra 504** verdi (durmuş konteynerin adresine bağlantı zaman aşımı,
  nginx'in varsayılan `proxy_connect_timeout`'u). Sonuç yine "hata", "boş pano" değil; ama API
  dururken her istek bir dakika asılı kalır — B4.1 şeridin ne zaman göründüğüne bakar.
- **A5 · VM yükseltme provası, `538ba54`'ten (VM'nin commit'i):** bulgu 1 yeniden görüldü (eski API
  imajı bugün derlenince SQLAlchemy 2.1.4, `greenlet` yok; yamayla açıldı, `0008`); bulgu 5 yeniden
  görüldü (eski nginx `POST /clinical` → 405 HTML; `/admin/users`, `/scope/me`, `/scores/…`,
  `/alarm-quality`, `/tenant/units` → 200 `index.html`). Eski şemaya 12 hesap + koğuş (pano 6) + bir
  sentetik büyük/küçük harf çakışması. Yedek ve geri dönüş etiketleri alındı; yeni imajlar aynı
  projede derlendi, çalışan konteynerler eski imajlarda kaldı. **`0010` ön kontrolü:**
  `PRE-FLIGHT STOP` (`[['TEST.Eczaci@…', 'test.eczaci@…']]`). Ön kontrol atlanınca (isteğe bağlı
  adım): API `restarting`, 8 yeniden başlama, `RuntimeError: Migration 0010 cannot backfill
  usernames…`, şema `0008`'de, `staff_scopes` yok. Yeniden adlandırınca `PRE-FLIGHT OK`; `up` →
  API kendiliğinden düzeldi, **`0011`**, 14 hesabın 14'ü yerel ve işaretli, eski roller gruplara
  döndü (`HOSPITAL_ADMIN`→`hospital_admin` …; çakışma kopyasının grubu yok), **pano 6**;
  `test.hemsire` `password_change_required: True`, `/patients` 403 → `POST /auth/password` → 200;
  C10'un on beş öneki JSON (401/404/405), hiçbiri `text/html`. **Geri dönüş:** eski imajlar `0011`
  veritabanında açılmaz (`FAILED: Can't locate revision identified by '0011'`, 7 yeniden başlama);
  döküm geri yüklenip eski imajlarla **`0008`**, API sağlıklı, **pano 6**, hemşire **eski**
  şifresiyle girer (200), yenisiyle giremez (401). Prova konteynerleri, birimleri, imajları (yeniden
  etiketlemeden sonra adsız kalan ikisi dahil) ve `wt-vm` çalışma ağacı silindi.
- **A6 · dashboard:** takım **76 dosya / 1809 test, 1809 geçti**; ekran kaydı boşa sabitlenmiş
  (`routes.test.js` hariç) **75 dosya / 1787 / 1787** — F3'ten sonra tamamen yeşil; `routes.test.js`
  sabitliyken yalnız kendi üç kayıt testinde düşer (beklenen; dışarıdan sabitleme onları bozar).
  Build karalamaya: `index` 146,74 / 48,01 kB gzip, `LiveApp` 206,66 / 63,90, `Toast` 186,01 /
  68,39, `DesignGallery` 8,61, CSS 28,94 + 7,46; önbellek 20 kayıt (753,04 KiB); 500 kB uyarısı
  yok; `dist`'te `legacyRoots`/`browser-` 0, `demo` 0. (İş istasyonu derlemesi `onrender.com`
  taşır — her zaman öyle; gönderilebilir olan yalnız A1'in imajı.)
- **A7 · backend (F1–F4 ajanının bu uçtaki ölçümü, yeniden koşulmadı):** Python 3.12.13 ve 3.14.5'te
  **2304 geçti, 8 atlandı** — üçte birler 1001 · 871+6 · 432+2; `tests/test_infinity_vm_pilot.py`
  hariç (Grup 4). F4 böylece kapandı: 3.14 artık ölçülü.
- **A8 · takım API imajının içinde:** **koşulmadı** — F7 kapısının maddesi açık (Part D, 10).
- **A9 · makine:** A0'da alınan dökümle aynı: 24 konteyner (adlar aynı; `homunculus-test-pg` ve
  `summa-*` çalışıyor, dokunulmadı), 29 birim, 68 imaj, 10 ağ, 4 çalışma ağacı; `git status` boş.
  Yalnız Docker'ın derleme önbelleği büyüdü (559 → 567 kayıt; başka projelerin önbelleğine
  dokunmamak için temizlenmedi). Karalamada `/c/tmp/g115plan/` kaldı.
- **Açık — işaretlenmedi:** **Part B** (tarayıcıda yürüyüş: dört dil, 390/1440 px iki temada, yalnız
  klavye, dört ret ekranda, Yönetim, eski adresler, Ayarlar, kilit, gerçek hoparlör ve Windows
  bildirimi); **Part C** (VM deploy — yalnız kullanıcıyla, sırayla; ajan VM'ye bağlanmaz);
  **kişi gerektirenler:** B10 (motorun gerekçe metinleri, Azerbaycanca konuşan bir klinisyen),
  B11 (Dalga 3B'nin beş metni, Azerbaycanca konuşan bir yönetici), servis duyurusu (C0.1), Part D'nin
  hastane maddeleri (AD soruları, NAT, sertifika, Chrome sürümü) ve A8.

> G1-15'teki VM deploy kullanıcının kararıdır (aşağıda "Kullanıcı kararları", 2–3; ikisi de
> 14.10'da yanıtlandı): yedek → `0010` ön kontrolü → göç `0008 → 0009 → 0010 → 0011` → herkes bir
> kez yeniden girer.

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
- **(Dalga 2 incelemesi; G1-16'yla değişti)** Tabletlerde ana ekrana eklenmiş uygulama: PWA
  manifestinin `start_url`'ü Dalga 2'de `/?demo=1`'den `/`'ye çekildi, ama kurulu bir kısayol
  tarayıcı manifesti yeniden okuyana kadar eski adresi açar. **G1-16'dan beri o adres de canlı
  sistemi açar** — `?demo=1` adresten silinir (`main.jsx` `withoutRetired`); simülasyon da yok,
  "sayfa yüklenemedi" de. Yeniden eklemek artık doğruluk için gerekmiyor: eski kurulumda kalan
  yalnız eski manifestin adı, açıklaması ve dilidir, tarayıcı manifesti yeniden okuyunca düzelir.
  Tabletleri yine de tek tek gözden geçirmek kullanıcının kararı.
- **(G1-16)** **Sesli alarm ve kritik alarm bildirimi gerçek bir serviste denenir** — yeni arayüze
  taşındılar (`999b1c9`, `a6ddabb`), ama yalnız taklit bir Web Audio ve taklit bir `Notification`
  ile test edildiler. Bir servis bilgisayarında, yerel yığında: (1) Ayarlar › "Ses ve bildirim"de
  ses açılır ve "Sesi dene" hoparlörden kritik düzeni (10 vuruş, 5+5) çalar; (2) kritik bir alarm
  gelince ses çalar, yüksekte ve ortada daha seyrek; alarm "Gördüm" ile onaylanınca susar; (3)
  ekran kilitlenir — ses sürer; çıkış yapılır — ses durur; (4) sayfa yenilenir — "Siqnal səsi
  gözləmədədir…" düğmesi görünür, bir tıklamayla kalkar; (5) bildirime izin verilir, başka bir
  pencere öne alınır, kritik bir alarm gelir — Windows bildirimi yatak adıyla görünür; kilitliyken
  gelen bildirim yatak adı taşımaz; (6) adres HTTPS değilse ekran bildirimlerin çalışmadığını
  söyler. Tarayıcı güvenli olmayan (HTTP) bir adreste bildirime izin vermez: VM HTTP üzerindeyse
  bildirim hiç görünmez (eski derleme de bunu ekranda söylüyordu) — bu deploy kapısında söylenir.
- **(G1-16, Görev 10'un tarayıcı adımı)** **Eski adresler ve yeni Ayarlar sekmesi bir tarayıcıda
  bakılır** — burada tarayıcı sürücüsü yoktu; adres temizliği yalnız jsdom'da test edildi. Yerel
  yığında `/?demo=1`, `/#/demo`, `/?eski=1`, `/?mode=replay&scenario=septic_shock` ve
  `/?board=1&token=x` açılır: her biri canlı arayüzün giriş ekranını gösterir ve adres çubuğu `/`
  okur; `/?tasarim=1` tasarım galerisini açar. Ayarlar › "Ses ve bildirim" 390 ve 1440 px'te, iki
  temada; sesi bekleyen düğme bir iletişim kutusu açıkken görünmez.
- **(Dalga 2 incelemesi)** VM'nin kendi nginx yapılandırmasında `location = /auth/reauth` ve
  `location = /auth/password` tam eşleşmeleri ile `homunculus_reauth` bölgesi **var mı** diye
  bakılır (`deploy/local/web/nginx.conf` ile karşılaştır). Yoksa istekler yine de vekillenir —
  önek bloğu yakalar — ama sınırsız ve JSON 429'suz: kilit açma ile şifre değiştirmede hız sınırı
  olmaz. Tek satırlık kontrol, deploy'dan önce.
- **(Dalga 2)** `?eski=1` (önceki canlı arayüz) G1-16 ile kaldırıldı ✅ (`2ba255c`): kilit ekranını
  bilmiyordu, kilitli bir tarayıcıda açık oturumu gösteriyordu. Adres artık canlı arayüzü açar.
- **(Dalga 2)** Mobil uygulama: geçici şifreli hesap girişte "önce panodan şifrenizi belirleyin"
  der (Dalga 2, Görev 3). Cihazlarda bu sürümden eski bir uygulama varsa, işaretli hesap orada her
  istekte çıplak 403 alır — deploy'dan önce güncellenir ya da kullanıcılar şifrelerini önce
  panoda değiştirir.
- **(Dalga 2)** Göç `0011` bütün yerel hesapları işaretler (karar 16): kullanıcılara deploy'dan
  önce duyurulur — yerel hesabı olan herkes (tohum yönetici dahil) ilk girişte bugünkü şifresiyle
  girip yenisini belirler; AD hesapları etkilenmez. İlk vardiya, aynı adresin arkasındaki bir
  serviste nginx'in `homunculus_reauth` bölgesini (dakikada 30, burst 30) şifre değişiklikleri ve
  kilit açmalarla paylaşır: bir dakika bekleyip yeniden denemek gerekebilir (runbook, "Updating").
- **(Dalga 3)** Azerbaycanca konuşan bir **klinisyen**, motorun kullanımdaki gerekçe metinlerini
  okur ve her birinin yazıldığı gibi anlaşıldığını onaylar. Motorun klinik metinleri
  (`clinical_reasoning`, `recommended_actions`, `confidence`, `chronic_context`, her `summary`)
  pilot için İngilizce kalıyor; kullanıcının bu karara bağladığı koşul budur, not değil kapı
  maddesidir. Metinleri dört kural ailesi üretir (`news2`, `septic_shock`, `acute_change`,
  `patient_relative`): kısa bir okuma, çeviri işi değil. Hangi metinlerin ekranda olduğu aşağıdaki
  yürüyüşün 3. adımında kaydedilir; okuma o listeye karşı yapılır.
- **(Dalga 3)** Servis deploy'dan **önce** bilgilendirilir: klinisyenler yeni bir yatak ekranı,
  yeni bir alarm ekranı ve bir hasta ekranı görecek; şüpheli enfeksiyon artık hasta ekranından
  işaretleniyor ve klinisyenin adıyla denetim kaydına yazılıyor.
- **(Dalga 3)** İlk kapsam atamasından önce `bed-mapping.json` keşif raporuyla karşılaştırılır:
  kapsamı sınırlı bir hemşirenin bir şey görüp görmeyeceğine yatak eşleme tablosu karar verir
  (eşleşmeyen bir kart hiçbir birime düşmez ve hiçbir atama ona ulaşmaz).
- **(Dalga 3)** Denetim kaydı, bir klinisyenin açtığı her hasta için bir `view` satırı taşımaya
  başlıyor (hasta ekranı açılınca `POST /view`; panoda olmayan bir hasta için gönderilmez):
  yalnız eklenen bir kayıtta yeni hacim, disk ve denetim ekranı için hesaba katılır.
- **(Dalga 3)** Aşağıdaki **uçtan uca yürüyüş** (Dalga 3'ün Görev 24'ü; koşulmadı, buraya katlandı)
  yerel yığında yapılır ve gözlemleri yazılır.
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

**G1-15 · (Dalga 3) Uçtan uca yürüyüş** — Dalga 3 planının Görev 24'ü. Koşulmadı; hiçbir gözlemi
yok, o yüzden burada gözlem değil yapılacak iş olarak duruyor. Birleşmiş ağaçta, yerel yığında
(`deploy/local`), sırayla; her adımın gözlemi yazılır — gözlemi yazılmamış bir adım yapılmamış
sayılır:

1. **Bütün dashboard takımı iki kez:** bir kez olduğu gibi, bir kez de ekran kaydı boşa sabitlenmiş
   olarak — hiçbir test hangi ekranların kurulu olduğuna sessizce bağlanmamış olmalı.
2. **Üretim derlemesi ve bedeli:** temiz derleme; ilk parçanın boyutu ve servis çalışanının önbellek
   sayısı kaydedilir (Dalga 2 sonu: 145 kB / 47 kB gzip, 22 kayıt / 556 KiB; G1-16 sonu: 146,74 kB
   / 48,02 kB gzip, 20 kayıt / ~753 KiB, 500 kB'ı geçen parça yok). İlk parça yaklaşık 250 kB
   gzip'i geçtiyse söylenir. G1-16 bölmeye gerek görmedi: ilk parçanın neredeyse tamamı React;
   `routing.test.js` ilk parçaya statik olarak giren importları sabitler.
3. **Dört dil, ekranda:** Yataklar → bir hasta → Alarmlar → Yönetim, az / tr / ru / en. Aranacaklar:
   çevirisi olmayan bir anahtarın görünmesi (`beds.something`), çekimli bir sözcüğün içine düşmüş
   sayı, Latin harfle yazılmış Rusça, Rusçada (dördünün en uzunu) kutusundan taşan satır. Bilerek
   okuyanın dilinde olmayan iki yere ayrıca bakılır: hasta ekranında motorun İngilizce gerekçe
   blokları — Azerbaycanca konuşan bir klinisyenin okuyacağı gibi okunur ve dört kural ailesinden
   hangilerinin metni ekranda olduğu yazılır (yukarıdaki klinisyen okumasının listesi budur);
   kapsamı sınırlı bir panoda Türkçe gelen `scope_note` — altındaki "bu cümleyi sunucu yazdı"
   satırının okuyanın dilinde olduğu (Türkçe değil) doğrulanır.
4. **390 px ve 1440 px, iki temada:** 390 px'te dört ekranın hiçbirinde yatay sayfa kaydırması yok;
   yatak kartları tek sütunda; yataklar ekranının kendi birim seçicisi ve araması erişilebilir (üst
   çubuğun birim çipi orada gizli); alarm satırları düğmeleriyle okunur; hasta ekranında vital
   ızgarası bir ya da iki sütun ve üç Sepsis-3 sayısı (SOFA, bazal, yükselme) her biri kendi
   etiketinin altında; Yönetim çerçevesi — başlığı, üç sekme düğmesi, yükleniyor satırı — sekme
   listesi iki ayrı liste gibi iki satıra kırılmadan sığar. 1440 px'te Gün temasında kart şeritleri
   ve durum hapları `card` üzerinde 3:1'i geçer (`tokens.test.js` yalnız değişkenleri tutar,
   bileşimi değil).
5. **Yalnız klavye:** atlama bağlantısından `<main>`'e, menüden, üst çubuktan, panonun denetimlerinden
   bir karta; Enter'la bir hasta açılır; Enter'la bir alarm "Gördüm" diye işaretlenir ve
   "kaydediliyor" satırı duyulur; Enter'la şüpheli enfeksiyon işaretlenir ve "işaretleniyor" satırı
   duyulur; yönetim sekmeleri arasında ok tuşlarıyla geçilir. Yalnız fareyle ulaşılan bir şey
   olmamalı; odak hiçbir zaman `<body>`'ye düşmemeli.
6. **Dört ret, bilerek:**
   1. API durdurulur → pano şeridi "Sunucuya bağlantı yok — … hasta olmadığı anlamına GELMEZ" der;
      hiçbir ekran "bekleyen yok" demez.
   2. Yalnız akış kesilir (nginx yeniden başlatılır ya da `/stream` engellenir) → güncel olmayabilir:
      veriler gösterilir ve işaretlenir, zilde amber nokta, menüde nokta, hiçbir yerde "yok".
   3. Hemşire olarak girilip panosunda olmayan bir kimlikle `#/patients/<id>` açılır → tek ve dürüst
      bir ileti (böyle bir kayıt yok ya da kapsamı dışında; ikisi ayırt edilmez) ve denetim kaydında
      bunun için **`scope_denied` satırı yok**.
   4. Denetçi olarak girilir (`board.view`, `audit.view`) → alarm ekranında onay düğmesi yok,
      `alerts.ack` yetkisini adlandıran satır var.
7. **Rapor:** sayılar, derleme boyutları, dört retin ekrandaki hâli, ekranda görülen motor gerekçe
   metinleri (klinisyen okumasının listesi) ve şimdi düzeltmeye değmeyen bulgular — "Dalga 3'ten
   açık kalanlar"a yazılır.

### Dalgalar

| Dalga | İşler | Paralel mi |
|---|---|---|
| 0 | G1-01 → G1-02 | Sıralı (her şey buna dayanır) |
| 1 | G1-03 → G1-04 ‖ G1-05 → G1-06 | İki kol paralel (arka uç / ön yüz) |
| 2 | G1-07 → G1-08 | Sıralı |
| 3 | G1-09 ‖ G1-10 ‖ G1-11 (+ yönetim temeli, birleşmedi) | Ortak temel sıralı, sonra üç kol paralel (yataklar, alarmlar, hasta) ✅ |
| 3B | G1-12 ‖ G1-13 ‖ G1-14 | Temel sıralı, sonra üç kol paralel; arka uç yarısı (Görev 14) ✅ |
| 4 | G1-16 → G1-15 | Sıralı; G1-16 kodu ✅ (tarayıcı adımı G1-15 Part B'de); G1-15 Part A ✅ 14.10 (`86117d6`), Part B ve C açık |

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

Dalga 3'ün karşıladıkları (`5a76853…91dbd05`) her maddenin altında; testler `dashboard/src/live/screens/`
altında, adlarıyla.

- Motorun `risk` değerleri açıkça eşlenir: `moderate` amber; `none`/`info` nötr
  ("bulgu yok / ölçülmedi"; `info` bir alarmdır, hep "Bilgi"). Hiçbiri yeşil "stabil"e düşmez.
  ✅ `ui/riskStyle.js`; `BedCard.test.jsx` `moderate is amber, never a green "stable"`. Motorun
  göndermediği ya da bu derlemenin tanımadığı bir risk dikkat görünümü alır, hiçbir zaman sakin gri.
- Kart `RiskPill`'e `measured`'ı açıkça geçirir (kartın zaman damgalarından).
  Geçirmezse `none` "ölçülmedi" okunur, "bulgu yok" değil.
  ✅ `BedCard.jsx` (`hasMeasurement(patient.measuredAt)`); hasta ekranı da aynı.
- Renk şeridi/noktası hiçbir zaman tek ipucu değildir: yanında ikon ya da metin olur.
  Gün'de `--mid`, `--high`, `--ok` dolgularının parlaklığı neredeyse aynı (1,01–1,04:1).
  ✅ Şerit hapın tonunu tekrarlar; hap ikon ve sözcük taşır. Şerit renkleri tek tablodan
  (`screens/common/BoardState.jsx` `RAIL`/`RAIL_LEFT`); tablonun tanımadığı bir ton dikkat rengine
  düşer. Gün temasında 1440 px'te 3:1 bakışı yapılmadı → G1-15 yürüyüşü.
- NEWS2 `red_param` kartı en az amber yapar. Motorla çatışıyor → aşağıda
  "Kullanıcı kararları", 9.
  **Bilerek karşılanmadı.** Kullanıcının seçimi (Dalga 3, Karar 5, seçenek d): `red_param` motorun
  düzeyinin yanında bir olgu olarak gösterilir ("Bir parametre 3 puan aldı") ve düzeyi
  değiştirmez; motorun hastanın kendi normaline göre düşürdüğü bulgunun yanında nötr bir hap
  ("Hastanın kendi normaline göre beklenen") motorun `chronic_context` açıklamasını erişilebilir
  adında taşır. Ölçütü doğru yapacak olan motor tarafı (seçenek b) açık klinik karar — "Dalga 3'ten
  açık kalanlar".
- Açık alarm kartın üstünde görünür. ✅ motorun kendi özetiyle (`BedCard.test.jsx` "puts the open
  alarms on the card, with the engine's own summary").
- Bağlantı durumu (DEGRADED/UNAVAILABLE) ekranda bir şeritle görünür;
  boş pano "sakin servis" gibi görünmez.
  ✅ `BoardStrip`; "boş ve canlı" cümlesini yalnız canlı pano söyler (`BedsScreen.test.jsx`).
- Besleme sağlığı çipi ("N yatak sessiz"). ✅ `FeedHealth`: yalnız canlı panoda konuşur; "hiç
  ölçülmemiş" ile "susmuş" iki ayrı sayı. Pencereleri tarayıcıda sabit → "Dalga 3'ten açık kalanlar".
- Motorun kapsam notu görünür. ✅ `ScopeNote`: motorun cümlesi olduğu gibi (Türkçe, `lang="tr"`) ve
  altında okuyanın dilinde "bu cümleyi sunucu yazdı" satırı; gizlenen kart sayısı.

**G1-10 Alarmlar**

- Alarm bandı `<body>`'nin doğrudan çocuğudur ve `MODAL_EXEMPT` taşır: açık bir pencere
  `#root`'u `inert` yapar ve `inert` içindeki canlı bölge (live region) susar.
  **Dalga 3'te bir alarm bandı yapılmadı** (zil, menüdeki sayaç ve Alarmlar ekranı var); ölçüt bir
  bant çizildiğinde geçerli. `MODAL_EXEMPT`'i bugün yalnız bildirimler (toast) taşıyor.
- (Dalga 3) İki bölüm: "Yanıt bekliyor" ve "Değerlendiriliyor". "Kapanan" bölümü yok: `/patients`
  yalnız açık alarmları taşır, geçmiş için uç yok; ekran kapanan bir alarmın nereye gittiğini tek
  cümleyle söyler. Eskalasyon motorun tek bayrağı (`escalated`), prototipin 3/5/10 dakikalık
  basamakları değil. Süre sunucunun anına göre `d:ss`, bir saatin üstünde `s:dd:ss`; motor ilk
  görülme zamanını göndermediyse süre gösterilmez. "Gördüm" sunucu kabul etmeden hiçbir şey yazmaz.

**G1-11 Hasta özeti**

- Her vitalin yaşı/bayatlığı görünür. ✅ `PatientScreen.jsx`: her değerin saati ve yaşı, sunucunun
  saatine göre (`useBoardNow`; `PatientScreen.test.jsx` "ages a reading against the SERVER's clock,
  not this browser's"). Ekran yaşı söyler, "çok eski"ye karar vermez: o eşik motorun; motorun bayat
  saydığı girdiler bulgunun altında motorun sözleriyle.
- NEWS2 eski vitallerle "tam" görünmez. Motor tarafı da var: `api/board.py`
  `news2.score()`'u tazelik uygulamadan çağırıyor → Grup 2 motor işi
  (aşağıda "Dalga 0'dan açık kalanlar").
  Ekran tarafı ✅: kısmi skor "kısmi" diye işaretlenir ve ölçülmeyen parametreler ekran okuyucuya
  okunur; motor skor göndermediyse "NEWS2: —" ve nedeni. Motor tarafı hâlâ Grup 2.
- (Dalga 3) Salt okunur değil: ekran tek bir şey yazar — şüpheli enfeksiyon var/yok
  (`POST /clinical/{id}`, `clinical.chart`; kullanıcı kararı, Dalga 3 Karar 27). Gerekçe: o
  işaretlenene kadar motorun sepsis kuralı hiç çalışmıyor (`septic_shock.evaluate` ilk satırında
  döner). SOFA formu ve hastanın kendi normali Grup 2'de.

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
- besleme sağlığı (Dalga 3: yataklar ekranına özet çip olarak döndü — kaç yatak sustu, kaçından
  hiç ölçüm gelmedi; cihaz sayfası Grup 4)
- duvar monitörü, RRT, ısı haritası
- alarm kalitesi, denetim bütünlüğü
- biyomedikal araştırma penceresi

Bu yüzden G1-15 öncesi kullanıcı kararı gerekir (aşağıda "Kullanıcı kararları", 2). **Karar
verildi 14.10: kabul** — deploy bunlar olmadan yapılır, Grup 2–4 geri getirir; servis duyurusu
septik şokun vazopresör bilgisi alamadığını ve uyarıların bazalsız çalıştığını söyler.

Tutulup bağlanmamış modüller → hedef:

- SOFA şiddet formu doldur/imzala (`severityScore.jsx`; `scores.sign` yoksa "İmzala" gizli) → G1-11.
  **Kullanıcı kararıyla → Grup 2** (Dalga 3: form, doğrulama ve imza ister; hiçbir kuralın çalışmasını
  engellemiyor). Hasta ekranı bunu ve vital eğrilerini tek kutuda "sonraki grupta" diye söylüyor.
- Şüpheli enfeksiyon ve bazal SOFA girişi (`setSuspectedInfection`/`setProfile`; bunlar olmadan sepsis kuralı hiç çalışmaz) → G1-11.
  ✅ **Şüpheli enfeksiyon G1-11'de** (`420bbbe`, kullanıcı kararı): hasta ekranı var/yok işaretler,
  hiçbirini önermez, ikisini de her zaman sunar ve işaretlemenin denetim kaydına adla yazıldığını
  önceden söyler. **Bazal SOFA ve hastanın kendi normali → Grup 2.**
- Alarm kalitesi paneli (`AlarmQualityPanel`, `clinicalAdmin.jsx`) → Grup 4
- Denetim bütünlüğü + motor denetim sayfası (`refreshAudit`/`verifyAudit`) → Grup 2
- InfinityBeds + cihaz sağlığı (`feedHealth`) → Grup 4
- Duvar monitörü + ad maskeleme politikası (`wallBoard.jsx`, `policySettings`) → Grup 2
- Arayüzde build SHA (`__BUILD_SHA__`) → G1-07 ✅ hesap menüsü ve Ayarlar › Profil.
- Motorun kapsam notu (`engineScope`/`scopeNote`) → G1-09 ✅ `ScopeNote` (`screens/common/BoardState.jsx`):
  yataklar, alarmlar ve hasta ekranında.
- RRT kuyruğu (`rrtQueue`) → Grup 2
- Isı haritası (`alarmDensity`) → Grup 2
- Hasta etiketi (`patientLabel`) → G1-09 ✅ `nameOf`: HBYS'nin adı ya da "kimlik bekleniyor"; cihazın
  hasta numarası ad yerine yazılmaz (yatak etiketi o kimliği zaten taşıyor).
- `patientScope.js` ekran kapsamı (rol yerine izin modeline uyarlanmalı) → G1-12

**G1-16 bu listede adı geçen modüllerin hepsini sildi** (`ab6dead`: `clinicalAdmin.jsx`,
`InfinityBeds.jsx`, `feedHealth.js`, `wallBoard.jsx`, `rrtQueue.js`, `alarmDensity.js`,
`patientLabel.js`, `patientScope.js`): sayfadan hiçbiri erişilebilir değildi ve
`reachable.test.js` artık bunu yasaklıyor. `refreshAudit` ve `setSuspectedInfection` eski
`liveStore.js`'in içindeydi, o da gitti (`2ba255c`); API istemcisinin `setProfile` ve `verifyAudit`
yöntemleri `backendApi.js`'te testleriyle kalır. Hedefleri değişmedi; kodları ve testleri
`e4cdf15`'te okunur (`git show e4cdf15:dashboard/src/<dosya>`). Liste aşağıda "G1-16'da
silinenler".

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
- escalationClock · Canlıda alarm ve eskalasyon süresi gerçek zamanla ilerler; simülasyonun 60× hızı uygulanmaz. → G1-10 ✅ `screens/common/elapsed.js`: sunucunun ilk görme anından, tarayıcının saatine sunucunun `Date` başlığından ölçülen fark eklenerek (`useBoardNow`).
- escalationClock · Süre biçimi: bir saatin altında `d:ss`, üstünde `s:dd:ss` (318:30 yazılmaz), negatif süre `0:00`. → G1-10 ✅ `elapsed.js`; motor ilk görülme zamanını göndermediyse süre hiç gösterilmez.
- loginRemember · "Beni hatırla" yalnız kullanıcı adını/e-postayı saklar, şifre ya da PIN'i asla; işaret kaldırılınca silinir; hatırlanan ad oturum açmaz, giriş ekranı yine gelir. → G1-08 ✅ `session/browserState.js`, `sessionStore.test.js`, `SignIn.test.jsx`.
- news2Honesty, news2Source · Kartta tek NEWS2 vardır, motorunki: motor göndermezse sayı yerine "—" ve nedeni (motor göndermedi) görünür; tarayıcı kendi NEWS2'sini (OAB'li yerel hesap) canlıda hiç göstermez. → G1-09 ✅ `News2` (`screens/common/BoardState.jsx`): kart, liste ve hasta ekranı aynı bileşeni kullanır.
- news2Honesty · Eksik vitalle hesaplanmış kısmi NEWS2 kartta işaretlenir (kısmi skor yalnız düşük gösterebilir). → G1-09 ✅ "kısmi" hapı; ölçülmeyen parametreler ekran okuyucuya okunur.
- patientBaseline · Hastaya özel alarm aralığı motora gider (`PUT /clinical/{id}/profile` · `baselines`); girilmeyen parametre gönderilmez (boş ≠ sıfır), ters aralık gönderilmeden reddedilir, kutu bunun cihaz alarmı olmadığını söyler. → Grup 2
- pharmacyView · Eczacının kendi sayfası vardır (antibiyotik saati, doz önermez, "kayıt yok"u "verilmedi" diye göstermez); eczacı ve sorumlu hekim görür, hemşire görmez. → Grup 3
- rrtPage · RRT ekranı menüdedir: hızlı yanıt ekibi ve yönetici görür, hemşire görmez. → Grup 2
- rrtPage · RRT ekranı kendisine eskale edilen alarmları (elle çağrıldıysa yazılı) ve yoldaki cevapsız alarmları ayrı gösterir; liste boşsa boş durumu, 3. kademe kapalıysa bunu açıkça yazar. → Grup 2
- rrtPage · Menü rozeti cevapsız eskalasyon sayısını gösterir; cevaplanan alarm rozetten düşer. → Grup 2
- setupWizardScope · Canlı kurulumda yönetici kurulum sihirbazına düşmez (kiracı deploy'da kurulur), doğrudan ürüne, Sistem Ayarları'na ve cihaz sayfasına ulaşır; diğer roller de doğrudan girer. → G1-07 ✅ sihirbaz yok; herkes kendi ana ekranına düşer (`shell/routes.js` `homePath`; Dalga 2'de Ayarlar; artık menünün açabildiği ilk kurulu ekran: panoyu gören herkes Yataklar'a, panoyu görmeyen ama kullanıcı ya da grup yöneten biri Yönetim'e), `LiveApp.test.jsx`. Sistem Ayarları ve cihaz sayfası G1-14 / Grup 4.
- simulationGating · Canlıda simülasyon denetimleri (alarm üret, saat hızı 30×/60×/120×, duraklat, "sonuç simüle et", DEMO etiketi) hiç çizilmez; mod belirtilmezse varsayılan canlıdır. → G1-16 ✅ Simülasyon koddan çıktı (`2ba255c`): her adres canlı sistemi açar, yalnız `?tasarim=1` tasarım galerisini.
- simulationGating · Break-glass canlıda kalır: araç değil, gerçek klinik denetim. → Grup 2
- simulationGating · Canlı Sonuçlar sayfası gerçek bekleyen sayısını ve elle yüklemeyi korur. → Grup 3
- simulationGating · Dil algılama bugün İngilizce yerel ayarda TR, Azerbaycanca cihazda AZ açar, seçilen dil kazanır (testleri `i18n.rbac.test.js`'te); D2 ile varsayılan AZ olunca bu testler birlikte değişir. → G1-06 ✅ Yeni kabukta `src/live/i18n/I18nProvider.test.jsx` (AZ varsayılan, algılama yok, saklanan seçim kazanır); `i18n.rbac.test.js`'teki eski vakalar eski çalışma alanıyla birlikte G1-16'da silindi (`2ba255c`).
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
- Denetim okumaları en ESKİ N satırı döndürüyor (`audit.py:255`, `audit_postgres.py:109`: `ORDER BY id ASC LIMIT n`): `/alarm-quality` (20 000) yoğun pilotta yeni epizotları kaçırır, `/audit` varsayılan 200 en eski olayları gösterir, `rehydrate` (1 000 000) sınırı aşınca en yeni ack/first_seen/kayıtları kaybeder; `limit`'lerin üst sınırı da yok. → Grup 2, alarm kalitesi paneli yeniden bağlanmadan ÖNCE · **G2 dilim 1:** üç denetim deposu da (bellek, SQLite, Postgres) `records(since=)` aldı (yalnız eğri ucu kullanıyor); `/audit`, `/alarm-quality` ve `rehydrate` hâlâ en eski N.
- Kapsam okunamadığında (UNKNOWN) `/patients` 200 + yanlış not dönüyor, `_require_patient` 404 + `scope_denied` yazıyor; her yerde 503 olmalı. → Grup 2 · **G2 dilim 1:** eğri ucu (`/patients/{id}/trends`) UNKNOWN'da 503 veriyor, `scope_denied` yazmıyor; öteki tek-hasta uçları hâlâ 404.
- Personel kapsamı yalnız pano uçlarında; kabul/eskalasyon/devir uçları kiracıya bağlı ama birime bağlı değil. → Grup 2 (karar 5)
- `api/board.py` NEWS2'yi tazelik uygulamadan hesaplıyor (`news2.score()`; tazelik yalnız kuralın `evaluate()`'inde): eski vitallerle kart "tam" görünebilir. → Grup 2 motor işi (G1-11 kabul ölçütü)
- Motor oda havası ve "Alert"i varsayıyor ama kısmi saymıyor (`rules/news2.py:140-143`). → klinik karar, kasaya dayanmalı (Grup 2; karar 7)
- Tüm uygulamanın rotalarını sınıflandıran tek bir test yok (scope/infinity/auth router'ları tabloda değil). → G1-03 öncesi küçük iş
- İzin açıklamaları güncel değil: `users.manage` kapsam atamayı, `devices.manage` canlı değerleri ve satıcı grubunu söylemiyor. → G1-13 — **kısmen**: roller tablosu açıklamaları artık sunucunun İngilizcesinden değil, izin anahtarına göre dört dilde kendi metninden gösteriyor (`strings/perms.js`; sunucunun metni yalnız bu derlemenin bilmediği bir anahtar için, İngilizce olarak işaretli yedek). ✅ **`9a62c0c` ile kapandı:** sunucunun metni (`auth/permissions.PERMISSIONS`) ve panonun dört dildeki metni birlikte düzeltildi — `users.manage` birim ve yatak kapsamını okumayı, ataması olmayanları saymayı ve kapsam atamayı (atayanın kendi kapsamı rolü gereği sınırsız olmalı), `devices.manage` salt okunur cihaz araştırma penceresini ve varsayılan olarak biyomedikal ile üreticinin destek grubunda (`platform_support`) olduğunu söylüyor.
- Kısmi NEWS2 ipucu ve `NEWS2_MISSING_LABEL` yalnız Türkçe. → G1-06 ✅ Dört dilde `src/live/i18n/strings/news2.js`; karta G1-09 bağlar.
- `patientFromBoard` `identity.bed_id`/`unit_id`'yi okumuyor: her HBYS hastası "yatak bekliyor" görünür; birim filtresi ve kapsam matrisi için gerekli. → G1-09 ✅ `9b07755`: ikisini de okuyor; yataklar ekranının birim süzgeci ve kapsam düzenleyicisinin seçenekleri bunlardan geliyor. Yatak tablosunun karşılamadığı HBYS konumu kartta "Yatak eşleşmedi · <anahtar>" diye yazılır.
- `auditRowFromRecord` kişi alanını `actor`'dan okumuyor (ack ve `scope_denied` satırları "—"); test fikstürü backend'in göndermediği `{by}` biçimini kullanıyor. → Grup 2
- Vite dev proxy'de `/admin`, `/scope`, `/scores`, `/infinity-research` yok (`/clinical` ve `/alarm-quality` var; yalnız `npm run dev`'i etkiler). → G1-07 ✅ `devProxy.test.js` nginx'in her API yolunu arar.
- `main.jsx`'te ölü `simulation` prop'u; PWA manifest `start_url: "/?demo=1"`. → G1-16 ✅ ikisi de Dalga 2'de düzeltildi: ölü prop gitti, manifest `start_url: "/"` ve `lang: "az"`. Yalnız **yeni** kurulumlar için geçerli: ana ekrana zaten eklenmiş bir kısayol, tarayıcı manifesti yeniden okuyana kadar `/?demo=1`'i — yani simülasyonu — açmayı sürdürür. Her tablette yeniden eklenmesi G1-15 deploy kapısındaydı; G1-16'dan beri o adres de canlı sistemi açıyor, yeniden ekleme yalnız kurulu uygulamanın adını ve dilini tazeler (kullanıcının kararı).
- `backendApi.myScope()` kullanılmıyor. → G1-12 ✅ Kullanıcılar sekmesi yöneticinin kendi kapsamını onunla okuyor: kapsam atama hakkı (`rules.canAssignScope`) yalnız `reason: "role"` iken var; yanıt gelmemişse bilinmiyor sayılır ve Kaydet çizilmez.
- `?infinityTest=1` yalnız ana çalışma ağacındaki commit'lenmemiş değişiklikte var. → kullanıcıya not
- `clinicalDemo.js:475`'teki demo yönetici parolası git geçmişinde; gerçek bir yerde kullanıldıysa değiştirilmeli. → kullanıcıya not (G1-16 dosyayı sildi; parola `e4cdf15` ve öncesinde, `origin`'de de, kalır)
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
  ✅ Dalga 3: değerlerin kendisi `ink` ile yazılır; kanal rengi yalnız `card` üzerindeki etikette
  (yatak kartı, hasta ekranı). Liste görünümünün `card2` başlığı ve zebrası kanal rengi taşımaz.
- Button `busy` (işlem sürerken) durumu → G1-10, ilk kullanımda. ✅ Eklendi (`6ab73a0`):
  `aria-busy`, odakta kalır, tıklamayı ve form gönderimini yok sayar.
- Dil, tema ve yazı boyutu sekmeler arası eşlenmiyor (`storage` olayı dinlenmiyor):
  bir sekmede değişince öbürü eskisinde kalır → G1-07. ✅ `storage` olayı dinleniyor (Dalga 2).
- Ekran okuyucu risk hapında yalnız düzeyi okur ("Orta"); görünmez "Risk:" öneki → G1-09.
  ✅ `ae08829`: hap, kendi sözcüğünde "risk" geçmeyen her etiketin önüne görünmez "Risk: " koyar
  (`ui/RiskPill.jsx`, `risk.prefix`).
- Pencere açıkken bildirime (toast) klavyeyle ulaşılamaz: pencere Tab'ı içinde tutar.
  Fareyle kapanır; yığın o sırada sağ üste çıkar (sağ altta altbilgiyi örtüyordu,
  390×380) → G1-10.
- `Field` hatası canlı bölge değil: gönderimde çağıran ilk geçersiz alana odaklanır,
  ekran okuyucu hatayı alanla birlikte okur → G1-08/G1-12 formları. ✅ G1-08'in bütün formları böyle (giriş, kod, şifre, kilit).
- Meşgul `Button` ekran okuyucuda yalnız "kullanılamaz" okunur; görünmez bir
  "kaydediliyor…" metni düşünülmeli → G1-10, ilk kullanımda.
  ✅ Çağıran söyler: "Gördüm" sürerken `Announce` "Kaydediliyor…", şüpheli enfeksiyon işaretlenirken
  "İşaretleniyor…" der (`AlarmsScreen.jsx`, `PatientScreen.jsx`).
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
  fontlar hâlâ önbellekte → G1-16. ✅ G1-16 (`8574bbb`): galeri parçası da çıktı
  (`globIgnores: ["**/DesignGallery-*.js"]`), 20 kayıt / ~753 KiB; fontlar canlı arayüzün, kalır.
- Test boşlukları: `Table`'ın `ResizeObserver` yolu (jsdom'da yok, yalnız `resize` yedeği
  test ediliyor) ve `Empty` testinin yalnız metni denetlemesi. → G1-07 ✅ ikisi de test edildi.
- Türkçe rehbere risk gösterim kuralları girsin (asla yeşil; "ölçülmedi" ≠ "bulgu yok";
  bilinmeyen/bildirilmeyen → dikkat). → G1-09 ✅ Rehber, "3.6 Yeni arayüzün klinik ekranları".

## Dalga 2'den açık kalanlar

- `?eski=1` (önceki canlı arayüz) kilit ekranını bilmez: kilitli bir tarayıcıda yeni sekmede
  `?eski=1` açılırsa oturum açık görünür → G1-16 kaldırır (G1-15 deploy'undan önce). ✅ `2ba255c`:
  `?eski=1` canlı arayüzü açar.
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
  ✅ **Dalga 3'ün yanıtı:** yataklar ekranının kendi birim seçicisi her genişlikte var (kapsam iki
  ya da daha çok birimse) ve üst çubuğun çipiyle aynı seçimi yazar. Seçim **bilerek saklanmaz**:
  kabuğun belleğinde durur, kilit ya da çıkışla gider — ortak bir istasyonda bir sonraki klinisyen
  başkasının daralttığı servise açmasın (Dalga 3, Karar 7; bu notun önerdiği saklama reddedildi).
  Bunun yerine süzgeç kaç kartı gizlediğini her zaman söyler.
- Kilit sayacı (yerel hesapta `reauth_failures`) AD sınırı gibi bellekte: yeniden başlatma
  sıfırlar, tek süreç → pilot için kabul (Dalga 1A'daki AD sınırıyla aynı karar).
- Zil: alarm ekranı (G1-10) gelince her satır hastaya/alarma bağlanır ve sol menüdeki Alarmlar
  maddesine sayaç gelir → G1-10.
  ✅ `0a698a3`: zilin her satırı hastasına, paneli Alarmlar ekranına götürür; menüdeki Alarmlar
  maddesi zilin kuralıyla sayar — sayı yalnız canlı panodan, güncel olmayabilecek panoda amber
  nokta, bilinemiyorsa hiçbir şey — ve maddenin erişilebilir adı aynısını sözle söyler. Motorun
  hastanın kendi normaline göre düşürdüğü bulgu sayaca girmez (düşürülmüş bir kritik ya da yüksek
  yine girer).
- Pano yeniden yüklendikten sonra gelen akış kareleri "istek gönderildikten sonra geldi" =
  "anlık görüntüden yeni" varsayımıyla üst üste konuyor; isteğin gönderilmesinden sonraya sarkan
  eski bir kare daha yeni bir anlık görüntünün üzerine yazılabilir (dar bir durum). Kalıcı çözüm
  `/patients` kayıtlarında ve karelerde sunucu tarafı sıra numarası, sonra "yeni olan kazanır"
  → Grup 2 (motor + pano).
- `/notifications` akışının kalp atışı (heartbeat) yok; yalnız eski çalışma alanı okuyor →
  G1-16'yla birlikte kalkar, kalacaksa kalp atışı eklenir. **G1-16: uç kalır** — panoda okuyan
  kalmadı (eski pano ve `api.js` silindi) ama mobil uygulama okuyor
  (`homunculus-mobile/src/transport/sseTransport.ts`, `/notifications?role=…`) ve onun da sessizlik
  bekçisi yok. Kalp atışı → Grup 5 (mobil).
- `reset_password` kilit sayacını commit'ten önce sıfırlıyor (yöneticinin kendi işlemi, zararsız)
  — kabul edildi.
- **Dalga 3 için notlar:** `resumePath` yalnız "`nav:false` ve parametresi var" durumunu reddeder,
  yani ileride parametreli bir ANA rota gelirse (`/beds/:unit`) kilit sonrası ona dönülür — o rota
  eklenince kural genişletilmeli. `stubScreens()` iç içe kullanılırsa katmanlar LIFO çözülmez
  (içteki çağrı dıştakini de temizler). `Shell.jsx` boş adreste `resumeTo.current ||
  home`'a gider: oturum ortasında hash silinirse ana ekran değil hatırlanan ekran açılır (zararsız).
  ✅ **Dalga 3'ün yanıtları:** parametreli bir ana rota eklenmedi, bu yüzden `resumePath`
  değişmedi — birim süzgeci adreste değil kabuğun belleğinde (yukarıdaki G1-09 notu), ve
  `/beds/:unit` istenmiyor: kilitten sonra bir sonraki kişiye daraltılmış bir servis vermesin diye;
  biri eklenirse kural o zaman genişletilir. `stubScreens` iç içe kullanılmıyor: `onlyScreens()`
  bütün tabloyu bir kerede kurar (`shell/screens.testutil.js`), hangi ekranların kurulu olduğunu
  soran test kendi derlemesini söyler. Boş adres davranışı olduğu gibi kaldı. Ayrıca Dalga 2'nin
  açık bıraktığı `aria-current`: hasta ekranı açıkken menüde Yataklar maddesi güncel okunur
  (`routes.js` `under: "beds"`, `41a2b83`); ekranda görünür bir "Yataklara dön" bağlantısı da var.
- Yeni metinler (`nav`, `shell`, `auth`, `lock`, `account`, `errors`'ın çoğu) AZ/RU/EN'de anadili
  konuşan bir klinisyenin okumasını bekliyor → pilot öncesi.

## Dalga 3'ten açık kalanlar

Plan: [dalga 3](2026-10-08-g1-dalga3-is-ekranlari.md) (G1-09 yataklar, G1-10 alarmlar, G1-11 hasta
ekranı; planın yönetim temeli — Görev 16–19 — Dalga 3B Görev 1'de birleşti, üç yönetim sekmesi
Görev 20–22'de yalnız şartnameydi). Sayılar yukarıda, iş listesinin altında.

**Yapılmadı:**

- **Uçtan uca doğrulama (Görev 24) koşulmadı** ve bu belgedeki hiçbir satır onun gözlemi değildir.
  Tarayıcı, dört dil ekranda, 390/1440 px iki temada, yalnız klavye, dört kasıtlı ret ve motorun
  gerekçe metinlerinin okunması G1-15 kapısına katlandı (yukarıda "G1-15 · (Dalga 3) Uçtan uca
  yürüyüş"). Ekranların kendi görevlerindeki tarayıcı bakışları (Görev 11 Adım 7, 12 Adım 9a, 14
  Adım 9a, 15B Adım 9) da hiçbir commit'te ya da çalışma notunda kayıtlı değil; ekranlar yalnız
  düzeni olmayan jsdom'da sınandı, yani bu dalganın her 390 px iddiası bir gereksinimdir, gözlem
  değil.
- Yeni metinler (`board`, `beds`, `alarms`, `patient`, `risk` ad alanları) AZ/RU/EN'de anadili
  konuşan bir klinisyenin okumasını bekliyor (dosyaların başlıkları böyle diyor) → pilot öncesi.
- ✅ **Yataklar başlığının altındaki sayı bağlantıya bakmıyordu — `e4cdf15` ile kapandı.** Bu
  belgeler yazılırken kod okunarak bulunmuştu: `BedsScreen.jsx` `beds.sub` "{count} yatak"ı her
  durumda basıyordu ve pano okunamadığında ya da daha yüklenirken başlık "0 yatak" diyordu — hemen
  altındaki şerit listenin gösterilmediğini söylerken ("bilinemeyen panodan sayı yok" kuralı,
  Dalga 3'ün klinik ekran incelemesi, kural b). Artık sayı yalnız bir okumanın ekrana koyduğu
  kartlar için basılır (canlı, ya da tutulup eskimiş diye işaretlenmiş); bağlanırken ya da yükleme
  başarısızken yalnız birim adı kalır ya da hiçbir şey (`BedsScreen.test.jsx` "counts no beds
  before a read has put any on screen"). Tarayıcıda görülmedi — G1-15 yürüyüşü bakar.

**Kullanıcının kararlarıyla kapananlar ve açık kalan yarısı:**

- **`red_param` ve motorun düzeyi.** Ekran tarafı kararlaştırıldı (Karar 5, seçenek d):
  `red_param` motorun düzeyinin yanında olgu olarak gösterilir ("Bir parametre 3 puan aldı") ve
  düzeyi değiştirmez; motorun `downgraded` diye işaretlediği bulgunun yanında nötr bir hap
  ("Hastanın kendi normaline göre beklenen") motorun `chronic_context`'ini erişilebilir adında
  taşır — "Düşük"ün yanındaki kırmızı parametre böylece bir motor hatası değil, açıklanmış bir
  düşürme olarak okunabilir. **Klinik soru açık:** seçenek b — `rules/patient_relative.py`,
  `red_param` doğruyken bir NEWS2 alarmını ORTA'nın altına indirmesin mi. Motorun vardığı sonucu
  değiştirir; kasada bir kaynak ve bir klinisyenin onayı ister (aşağıda "Kullanıcı kararları", 9).
  Karar verilirken bilinmeli: `_adjust_news2` açıklayamadığı değil, **puanı olmayan** parametreyi
  atlar (`pts <= 0 → continue`), yani kayıtlı bir normal, yedi parametrenin dördüyle hesaplanmış
  **kısmi** bir NEWS2'yi de DÜŞÜK'e indirebilir; ölçülmeyen üç parametre hakkında hiçbir şey
  söylemeden. Kart "kısmi"yi ve eksik parametreleri hapın yanında gösterir; yalnız düzeyi okuyan
  bunları görmez.
- **Şüpheli enfeksiyon Grup 1'de işaretleniyor** (Karar 27, `420bbbe`): hasta ekranının yazdığı tek
  şey. SOFA formu ve hastanın kendi normali Grup 2'de.
- **Motorun klinik metinleri pilot için İngilizce kalıyor** (Karar 24): `clinical_reasoning`,
  `recommended_actions`, `confidence`, `chronic_context`, her `summary`. Onları basan her yer
  `lang="en"` işaretli ve ekran bunu okuyanın dilinde söyler ("Motorun metinleri İngilizcedir;
  çevrilmemiştir"). Koşul: pilot öncesi Azerbaycanca konuşan bir klinisyen kullanılan gerekçe
  metinlerini okur — **G1-15 kapı maddesi**.
- **Motorun düşürdüğü bulgu kimseye "yanıtla" demez** (Karar 26): kartta, alarm listesinde ve
  motorun metninde görünür kalır; yanıt bekleyen kuyruğu, zili ve menü sayacını sürmez (motorun
  sözleşmesi: "görünür kalır ama alarm ya da eskalasyon yapmaz"). Alt sınır: düşürülmüş bir
  KRİTİK ya da YÜKSEK yine sayılır. Kullanıcı bunu tersine çevirebilir — tek fonksiyonda tek sözcük.

**Açık — arka uç ya da sonraki grup:**

- `feedHealth`'in kanal başına pencereleri tarayıcıda sabit (nabız ve SpO₂ 300 s, basınçlar 900 s,
  solunum 600 s, sıcaklık 1 saat, laktat 6 saat; son ikisi "yatak sustu mu" sorusuna katılmaz) ve
  sunucuya aittir; 20–30 dakikada bir ölçen manşonlu bir serviste sistolik ve ortalama basınç
  neredeyse hep "gecikmiş" sayılır (sessiz yatak saydırmaz, hiçbir değeri boyamaz) → Grup 2,
  sitenin NIBP aralığıyla.
- Bir kapsamın adlandırabileceği birim ve yatakları listeleyen uç yok. G1-12 bunu Dalga 3B'de liste
  olarak karşıladı (yukarıda kabul ölçütleri); uç → Grup 2, yatak eşleme işiyle.
- `api/board.py` NEWS2'yi hâlâ tazelik uygulamadan hesaplıyor → Grup 2 (Dalga 0'dan).
- Pano yanıtında sunucu saati ve kayıt başına sıra numarası yok. Tarayıcı her yanıtın `Date`
  başlığından saat farkını ölçüp yaşları onunla düzeltiyor (`useBoardNow`), yani bu artık bir
  doğruluk açığı değil; kalan iş bir cihazın saati bozuksa bunu **birine söylemek** — cihaz
  sayfasıyla Grup 4. Sıra numarası Grup 2 (Dalga 2'den).
- `GET /patients/{id}` yok: hasta ekranı hastayı oturumun zaten tuttuğu panodan okur. Bugün doğru —
  `/patients` kapsamla süzülüyor ve sunucu "yok" ile "kapsamınız dışında"ya bilerek aynı yanıtı
  veriyor — ama ekran panosuz açılamıyor ve yeniden yüklenen bir derin bağlantı bütün servisin
  yüklenmesini bekliyor → hedef grup seçilmedi.
- `/audit` ve `/alarm-quality` en ESKİ satırları döndürüyor → Grup 2 (Dalga 0'dan): Grup 2'nin denetim
  ekranı buna dayanamaz.
- `api/board.py` `scope_note`'u istenen dil ne olursa olsun Türkçe yazıyor; ekran `lang="tr"`
  işaretliyor ve okuyanın dilinde nereden geldiğini söylüyor. Düzeltme motorun istenen dilde yanıt
  vermesi; önce isteğe bir dil gerekir → Grup 2.
- Bir alarmın `kind`'ı ham bir kısa ad (`news2_red_param`, `sepsis_antibiotic_overdue`); motor
  `summary` göndermezse ekranların bastığı budur. Motor bugün hep gönderiyor, yani bu bir dikiş,
  kusur değil — ama bir klinisyenin okuyacağı adlar kaynaklarıyla kasaya, sonra motorun yanıtına
  aittir; ekranın bir sözlük dosyasında uydurulamaz.
- Alarm geçmişi ucu yok: Alarmlar ekranında iki bölüm var, kapanan alarm panodan düşer ve denetim
  kaydında yaşar (`audit.view` ister, hiçbir hemşirede yok) → Grup 2, denetim ekranıyla.
- `identity_only_board` (`api/board.py`) `sepsis` ve `meds` bloklarını göndermiyor, oysa yorumu
  "patient_board ile aynı anahtarlar" diyor. Pano tarafı düzeltildi (`0a4f754`: şüpheli enfeksiyon
  işaretlemesi blok yokken de çiziliyor); motor tarafı → Grup 2: iki bloğu dürüst boşlarıyla
  göndermek ya da yorumu düzeltmek.

**Dalga 3B'nin kapattıkları** (Dalga 3 planı bunları açık listeliyordu):

- ✅ `/scope/me` panoyla aynı kararı veriyor (`enforce_unassigned` ve break-glass) — Dalga 3B Görev
  14, `fa8c522` (yukarıda G1-12 kabul ölçütü).
- ✅ G1-12 / G1-13 / G1-14: Dalga 3'te "kısmen" (temel yazılmış ama birleşmemiş, sekmeler yalnız
  şartname) — Dalga 3B kurdu, iş listesinde ✅.
- ✅ `GroupOut` grubun rol mü ek görev mi olduğunu söylüyor (`kind`) — Dalga 3B Görev 14, `fa8c522`.
- ✅ İki izin açıklaması (`users.manage`, `devices.manage`) — `9a62c0c`.
- `GET /admin/users` sayfalamasız: Dalga 3B'de kullanıcının kararıyla pilot için bırakıldı
  (aşağıda).

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
- ✅ **İki izin açıklaması eskiydi — `9a62c0c` ile kapandı:** `auth/permissions.PERMISSIONS`'ta
  `users.manage` birim kapsamı rotalarını (`/scope/{id}`, `/scope/unassigned`, `PUT /scope/{id}`),
  `devices.manage` cihaz araştırma penceresini ve satıcı grubunun (`platform_support`) onu
  taşıdığını söylemiyordu; panonun dört dildeki metinleri (`strings/perms.js`) aynı eksikleri
  ekranda da taşıyordu. İkisi birlikte düzeltildi.
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
  **Üçüncü bütün-küme yazması, birim kapsamı, 14e'nin dışında kalmıştı** — dalganın son bütün-dalga
  incelemesi buldu, `a301c73` kapattı: `PUT /scope/{id}` de kullanıcının bütün kapsamını sürümsüz
  değiştiriyordu; eski bir pencereden yapılan kayıt başka bir yöneticinin az önce verdiği birimi
  sessizce geri alıyor, aynı anda iki kayıt ikisinin BİRLEŞİMİYLE bitebiliyordu. Şimdi rota her
  `/admin` yazmasının aldığı kiracı yönetim kilidini (`lock_admin_guard`) bir şey okumadan alır —
  bir hastanenin kapsam yazmaları sırayla işlenir — ve `expected_grants`'ı (pencerenin okuduğu
  atamalar) şimdikilerle (birim, yatak) çiftlerinin **kümesi** olarak karşılaştırır; farklıysa 409
  `CONCURRENT_CHANGE`, hiçbir şey yazılmaz, denetim satırı olmaz; alan yoksa eskisi gibi, `[]`
  gerçek bir beklenti. Kapsam penceresi 409'da kapanır, hesabın başka masada değiştirildiğini
  söyler; satır ve sayaç yeniden okunur.
- ✅ **Son bütün-dalga incelemesinin iki "yeniden okuma" bulgusu** (`d9bb996`): (1) bir AD grup
  eşlemesini silmek o grubun AD'den gelen üyeliklerini sunucuda HEMEN kaldırır, ama giriş kaynağı
  sekmesi yalnız kendi tablosunu yeniden okuyordu — Kullanıcılar sekmesi sunucunun az önce aldığı
  rolü göstermeye, Roller sekmesi eski üye sayısını göstermeye devam ediyordu. Kaydedilen (ya da
  yanıtsız kalıp kaydedilmiş olabilecek) bir silme artık çerçevenin listelerini de yeniden okur;
  yeni bir eşleme kimseyi hemen değiştirmediği için okumaz. (2) Bir kapsam kaydı "hiç atama
  yapılmamış kullanıcı" sayısını değiştirir, ama sekme yalnız o kişinin kapsamını yeniden okuyordu;
  artık kayıttan ve yanıtsız kaydın geri okumasından sonra sayı da yeniden okunur. İkisi de yalnız
  isteyen oturum için. Ayrıca (`7275c11`) roller sekmesinin yeni grup formu meşgulken alanlarını
  `disabled` değil `readOnly` tutar (odak `<body>`'ye düşmez).
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

## G1-16'dan açık kalanlar

Plan: [G1-16](2026-10-13-g1-16-eski-modlari-kaldir.md). Silinen her dosya `e4cdf15`'te okunur
(`git show e4cdf15:dashboard/src/<dosya>`); o commit `origin/feat/canli-tasarim`'de de var.

- ✅ **Görev 10 (son doğrulama) yapıldı** (13.10, Görev 1–5'in incelemesinden sonra): test takımı
  iki kez, build bütçesi, "kaldırılan bir mod hâlâ anılıyor mu" aramaları. Yapılamayan tek adımı —
  tarayıcıda bakış — G1-15 kapısında (yukarıda).
- ✅ **Sesli alarm ve arka plan bildirimi taşındı** (`999b1c9`, `a6ddabb`; kullanıcı kararı 18,
  13.10) — `live/signals/`. Eskisi gibi: eski derlemenin aynı ses düzenleri (`clinicalAudio.js`'in
  sayıları), yanıt bekleyen en kötü alarm, gizli sayfada kritik alarm başına bir bildirim. Yeni: kilitte de çalar, kilitliyken
  bildirim yatak adı taşımaz, oturum bitince ses durur ve bildirimler kapanır; ayar tarayıcıda
  saklanır ve tarayıcı sesi başlatana kadar "bekliyor" der (düğme ekran okuyucuya da söylenir, bir
  iletişim kutusu açıkken gizlenir). Görev 1–5 incelemesinden sonra (`cf1aa7c`): tarayıcı sesi
  askıya alıp geri verince ses kendiliğinden sürer; susunca zamanlanmış vuruşlar da kesilir; pano
  ilk yüklemeden sonra, akış daha açılmadan da çalar ve bildirir (eskisi de ilk yüklemede çalardı);
  bildirim alarm başına bir `tag` taşır (iki sekme aynı alarmı üst üste yığmasın diye; alarm
  anahtarının FNV-1a özeti, hasta kimliğini taşımaz; kilitliyken hiçbir şey adlandırmayan ayrı bir
  tag); sayfa kapanınca açık bildirimler kapanır; dışarıdan kapatılan bir bildirim alarm hâlâ
  bekliyorsa panonun bir sonraki değişikliğinde yeniden gelir; "ses bekliyor" duyurusu bir iletişim
  kutusu açıkken de ekran okuyucuya ulaşır. Açık kalan:
  gerçek hoparlör ve Windows bildirimi denemesi (yukarıda G1-15 kapısı).
- **Eskisinden bilinçli farklar** (planın Karar 17 ve 23'ü): önem derecesi bilinmeyen bir alarm
  kritik gibi çalar ve kritik bildirim de verir (eskisi sessizdi); düşürülmüş (kronik beklenen)
  orta bir alarm sessizdir (motor bugün böyle bir alarm gönderemez: yalnız düşüğe indirir); bildirim
  kilit açılınca, cevaplanan ya da kalkan bir alarm yeniden bekleyince ve her yeni oturumda yeniden
  gelir (eskisi sayfa ömrü boyunca alarm başına bir kez bildirirdi).
- **Ses düzeni bir klinik standarda göre gözden geçirilmedi.** Eskinin sayılarıdır, eşitlik için
  korundu; IEC 60601-1-8'in düzeni değildir (kritik bir dizi ~2,8 sn sürer, 2,5 sn'de bir yinelenir,
  ikisi üst üste biner). Bir klinisyen ya da biyomedikal mühendis standarda göre gözden geçirir →
  Grup 2.
- ✅ **Bildirim metni eskisi gibi kalır** (kullanıcı kararı 19, 13.10): uygulama açıkken alarmın
  yatak etiketi, etiket yoksa hasta kimliği (`liveAdapters.js` `bedLabel`, eski derlemedeki gibi);
  uygulama kilitliyken bildirim hiçbir yatak ya da hasta adlandırmaz (`signals.notifyBodyLocked`)
  ve yatak adı taşıyanlar kilitte kapanır. Bildirim kapatılana dek kalacak şekilde istenir
  (`requireInteraction`); Windows'ta nasıl göründüğü denenmedi (G1-15 kapısı).
- **Üst çubukta ses göstergesi yok** (eskisinde düğme vardı); ayar Ayarlar'da, bekleyen ses için
  ekranın köşesinde bir düğme. Üst çubuğa bir gösterge eklemek tasarım kararı. → kullanıcı / tasarımcı.
- **Vercel'deki genel yayın** (`homunculus-ai.vercel.app`) ve arkasındaki Render API'si hiçbir
  commit'le kapanmaz; kod tarafında demo kalmadı. `main`'e her push Vercel'i yeniden derler
  (`docs/DEPLOY-SUPABASE.md`): bu dal main'e birleşirse ve proje bağlıysa o adres simülasyonu değil
  canlı arayüzün giriş ekranını gösterir. Yayından kaldırma ve `vercel.json` / `render.yaml` /
  `dashboard/.env.production`'ın akıbeti → kullanıcı.
- `homunculus-engine/scripts/record_demo.py` (+ `test_record_demo.py`, `test_record_ward.py`)
  replay'in JSON'unu üretiyordu; artık okuyanı yok. Senaryo YAML'ları kalır (motor testleri ve
  `scripts/replay.py`). → Grup 4 (temizlik) ya da kullanıcı.
- `lucide-react` paketi artık kullanılmıyor (Vite ağaçtan atar, paket ağırlığı yok); kaldırmak
  bütün G1 worktree'lerinin paylaştığı `node_modules` bağlantısında `npm uninstall` demek. → Grup 4.
- `liveAdapters.js`'in eski uyarı alanları (`tier`, `firedAtSec`, `currentStep`, `events`,
  `snooze`, `mutedUntil`, `auto`, `trigger`) ve canlıda okunmayan üç dışa aktarımı
  (`bedsFromPatients`, `ageFromBirthDate`, `awaitingLocalAdmission`) testleriyle kaldı;
  `ageFromBirthDate` ile `awaitingLocalAdmission` Grup 2'nin kabul ekranının sözleşmesi (yukarıda
  "Main'den gelen ve yeni kabukta karşılanacak davranışlar"). Yalnız `ack.atSec` gitti
  (`47ca495`). → Grup 2.
- `/notifications` kalp atışı → Grup 5 (yukarıda "Dalga 2'den açık kalanlar").

**G1-16'da silinenler** (her biri `e4cdf15`'te; testleri koruduğu davranışın kaydıdır; test sayıları
G1-16'nın tabanında):

| Silinen | Testi (test) | Ne yapıyordu → nereye |
|---|---|---|
| `wallBoard.jsx` | `policySettings.test.jsx` (13) | Duvar monitörü + ad maskeleme → Grup 2 |
| `rrtQueue.js` | `rrtQueue.test.js` (11) | RRT kuyruğu → Grup 2 |
| `alarmDensity.js` | `alarmDensity.test.js` (11) | Isı haritası → Grup 2 |
| `severityScore.jsx` | `severityScore.test.jsx` (10) | SOFA formu ve imza → Grup 2 |
| `clinicalAdmin.jsx` | `alarmQualityPanel.test.jsx` (7), `auditIntegrity.test.jsx` (6) | Alarm kalitesi → Grup 4; denetim bütünlüğü → Grup 2 |
| `InfinityBeds.jsx` | `InfinityBeds.test.jsx` (9) | Cihaz sağlığı → Grup 4 |
| `admissionPage.jsx`, `patientLabel.js` | `patientLabel.test.js` (15) | Kabul / transfer / bakım ekibi, barkod etiketi → Grup 2 |
| `patientScope.js` | `patientScope.test.js` (15) | Ekran kapsamı → G1-12 ✅ sunucuda |
| `feedHealth.js` | `feedHealth.test.js` (22) | → G1-09 ✅ `live/screens/common/feedHealth.js` |
| `risk.js` | `risk.test.js` (2) | → G1-09 ✅ `pillRisk` |
| `clinicalUi.jsx`, `ui.jsx`, `clinicalTheme.js` | `ui.test.jsx` (9) | Eski bileşenler ve tema → `live/ui`, `live/theme` |
| `loginHero.jsx` | — | Eski giriş ekranı sahnesi → yok (D4 girişi) |
| `liveStore.js` | `liveStore*.test.js` (48 + 47 + 25), `auditFromEngine.test.js` (12), `clinicalCharting.test.js` (6), `scopeAssignment.test.js` (3) | Eski canlı store → `live/session`, `live/data` ✅; denetim satırı (`auditRowFromRecord`) → Grup 2; klinik girdi → Grup 3; kapsam ataması → G1-12 ✅ |
| `liveAdmin.js`, `admin/*` | `liveAdmin.test.js` (28), `LiveUserAdmin.test.jsx` (35), `GroupAdmin.test.jsx` (20) | → G1-12/13 ✅ `live/screens/admin` |
| `clinicalI18n.js` | `i18n.rbac.test.js` (109) | → G1-06 ✅ `live/i18n`; sunucu iletileri `live/apiErrors.test.js`'te |
| `permissions.js` | `permissions.test.js` (14) | → `live/screens/admin/catalogue.js` ✅ (grupların hakları sunucunun) |
| `clinicalAudio.js`, `ClinicalDemo.jsx`'in bildirimi | — | Sesli alarm, arka plan bildirimi → ✅ silinmeden önce taşındı: `live/signals/` (`999b1c9`, `a6ddabb`) |
| `ClinicalDemo.jsx`, `clinicalDemo.js`, `legacyRoots.jsx`, `DemoDataBanner.jsx` | `ClinicalDemo.rbac.test.jsx` (43), `nav.test.js` (6), `clinicalDemo.test.js` (123), `legacyRoots.test.jsx` (4; ikisi `8c0ed89`'de), `DemoDataBanner.test.jsx` (4) | Simülasyon ve önceki canlı arayüz → yok (D1) |
| `Board.jsx`, `PatientDetail.jsx`, `PatientList.jsx`, `NotificationHistory.jsx`, `Toasts.jsx`, `notifications.js`, `api.js`, `i18n.js`, `theme.js`, `demo.jsx`, `demoTransport.js`, `public/demo/*.json` | 38 test, 9 dosya | Eski pano ve replay → yok (D1) |

## Kullanıcı kararları (Dalga 0 sonrası)

Öncelik sırasıyla. (18–20 numaralı kararlar G1-16'da verildi: yukarıda "G1-16'da kullanıcının
verdiği kararlar". 12–17 numaralı kararlar Dalga 2'de soruldu ve yanıtlandı: yukarıda
"Dalga 2'de kullanıcının verdiği kararlar".)

1. **VM bugün (bu daldan bağımsız):** risk eşlemesi hatası VM'de de var (orta risk yeşil görünüyor) — VM'ye hotfix mi, G1-09'u mu bekler? VM'nin nginx'i `/clinical`, `/scores`, `/alarm-quality`'yi iletiyor mu (iletmiyorsa VM'de klinik giriş/SOFA imzası motora hiç ulaşmamış olabilir)? Kontrol: `curl -sk -X POST https://<vm>/clinical/x -H 'Authorization: Bearer x'` → JSON 401 = iletiliyor, HTML/405 = iletilmiyor.
2. **G1-15 deploy kapısı:** Grup 2–4'e kalan VM yetenekleri (özellikle vazopressör/sıvı girişi, hasta normali, kabul profili, besleme sağlığı) kaybedilsin mi, Grup 1'e mi alınsın, yoksa deploy beklesin mi? (Dalga 3 bunlardan yalnız besleme sağlığını yataklar ekranına özet çip olarak getirdi — bir de listede olmayan şüpheli enfeksiyon işaretlemesini; geri kalanlar hâlâ açık.)
   **Yanıtlandı 14.10 (kullanıcı): kabul — şimdi deploy edilir; eksikleri Grup 2–4 geri getirir.**
   Deploy'un VM'den kaldırdığı her şey ("Bu dal VM'ye çıkmaz" listesi; panodaki Infinity araştırma
   penceresi dahil, Biyomedikal grubu yeni arayüze giremez) bekleme nedeni değil. Servise duyuru
   (G1-15 planı C0.1) bu sürede **septik şok kuralının vazopresör bilgisi alamadığını** ve
   **uyarıların hastaya özel bazal değer olmadan çalıştığını** söyler.
3. **Geçişte zorunlu MFA:** 4 grup (Sistem Yöneticisi, Sorumlu Hekim, Ünite Hekimi, Üretici Destek) ilk girişte TOTP kuracak (VM hiç zorlamadı) — kabul mü, pilot için gevşetilsin mi?
   **Yanıtlandı 14.10 (kullanıcı): dört grup için de zorunlu kalır** — gevşetilmez. `0010` dört
   grubu `mfa_required` işaretler (A1'de ölçüldü); üyeleri ilk girişte TOTP kurar (G1-15 planı C11).
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
   **Ekran yarısı yanıtlandı (Dalga 3, Karar 5, seçenek d):** ikisi de gösterilir, biri ötekini
   geçersiz kılmaz; motorun düşürdüğü bulgunun yanında nötr "Hastanın kendi normaline göre
   beklenen" hapı motorun açıklamasını taşır. **Motor yarısı açık** (seçenek b: `red_param`
   doğruyken NEWS2 alarmı ORTA'nın altına inmesin) — kasada kaynak ve klinisyen onayı bekliyor;
   ayrıntı "Dalga 3'ten açık kalanlar"da.
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
