# HBYS programı · ayrıştırma oturumu için girdi

**Tarih:** 2026-11-02 · **Dal:** `docs/hbys-yol-haritasi-girdisi` (origin/main `720e48f`) · **Kod okuması:** main
`720e48f`. **Niteliği:** girdi belgesi; karar belgesi değil. Kararlar sahibin; bu belge yalnız seçenekleri ve
soruları dizer. Örneklerdeki numaralar ve adlar uydurmadır (`202600000001`, `H00000001`, «Test Hasta»).

## 1. Amaç

Sahip, B1d'yi isterken Homunculus'un hastanenin HBYS'si olacağını söyledi (B1d spec §1, §12). B1d bunun ilk görünür
parçasını yaptı: Homunculus her yeni kabule 12 haneli bir protokol numarası verir. B1d spec §12 kalanı açıkça
dışarıda bıraktı: kalıcı hasta numarası ve dönen kişiyi eşleştirme (D2), ayaktan gelişler, «HBYS programının
tümü: kendi yol haritası, sahiple ayrıştırılacak», bileklik ve ZPL, H-numarası barkodu, açık kabullere protokol.
Bu belge o oturum için masaya konur: bugün kodda HBYS'ye benzeyen ne var (§2), kimlik modelindeki boşluk (§3),
jenerik HBYS modüllerinin burada ne anlama geldiği (§4), aday bir ayrıştırma ve sıra (§5), karar soruları (§6) ve
oturumdan önce başlanmayacaklar (§7). Her kod iddiası dosya satırı verir; her niyet iddiası bir belgeye dayanır;
emin olunmayan yer «doğrulanmalı» der. Ülkeye özgü hiçbir mevzuat, sigorta sistemi ya da e-sağlık kuralı iddia
edilmez; akla gelenler soru olarak yazılır.

## 2. Bugün Homunculus'ta HBYS'ye benzeyen ne var

Yalnız kodun gösterdiği. «VM'de» = hastane sunucusunda çalışıyor (roadmap satırları ve proje hafızası; VM'nin
şu anki hâli `e88f19e`, B1d + takip, 2026-11-02).

| Yetenek | Kodda nerede | Durum |
|---|---|---|
| Kabul: prototipin tam formu, bir kabul = bir yatak = bir kart, H-numarası | `admission/router.py:434` `POST /admissions` (:508 her kabulde yeni `Patient` satırı), `admission/form.py`, `admission/numbers.py` (`H` + yıl + 5 hane), `admission/boardlink.py`; göç `0012` | VM'de (B1a, 28.10) |
| Hekim imzası (DRAFT → ACTIVE) | `admission/router.py:745`; `admission/service.py:149` | VM'de |
| Taburcu: hekim başlatır (çıkış şekli), sorumlu hemşire onaylar; kritik alarm tutar | `admission/router.py:953`, `:1014`; `admission/service.py:405`, `:438`; `admission/models.py:139` `DischargeDisposition` | VM'de |
| Nakil (birimler arası) | `admission/router.py:886–947` iki rota 409 `transfer_unavailable` (A-37); servis kodu duruyor `service.py:290`, `:314`; protokol nakilde taşınır `service.py:340–349` (O8) | **Kapalı** — main'de ve VM'de kapalı; B1b yeniden açar |
| Yapı ağacı: Tenant → Site → Unit → Room → Bed; yatak durum makinesi | `tenant/models.py:55–176` (`UnitType` :23–30 **yalnız 5 YBÜ türü**; `BedState` :32–40); `tenant/router.py:387` `GET /tenant/structure`, `:457–517` `PATCH`, `:607` release | VM'de; koğuş Yapı'da kurulu |
| Protokol numarası (12 hane, yönetici başlangıcı, yalnız ileri) ve 50×30 Code 128-C etiket | `protocol/numbers.py`, `protocol/models.py:26` `protocol_settings`, `protocol/router.py:67`/`:76` `/admin/protocol-settings`; `admission/router.py:784` `POST …/label`; göç `0015` | VM'de (02.11) |
| Kart anahtarı: `protocol_no or patient_number` | `admission/boardkey.py` | VM'de |
| Kart kimlik deposu (pano tarafı): numara → ad, DOB, cinsiyet, yatak; `kabul` mezar taşı | `api/patient_identity.py:85` `IdentityRecord`, `:49` `KABUL`, `:52` `is_tombstone`; `api/patient_identity_postgres.py`; göç `0005` (PK `(tenant, patient_id)`), `0006`, `0012` | VM'de |
| Comed ADT yolu: HL7 ADT → kimlik kaydı; köprü aynası | `edge/adt.py:174` `parse_hl7_adt`, `:137` PID-3 okuması; `edge/bridge.py:98–160`; `edge/identity.py` (SQLite ayna); spec `2026-09-04-comed-adt-identity-design.md` | Kod VM'deki köprüde; **akış hiç gelmedi** (B1d spec §1; roadmap bulgusu 05.09'dan beri sessiz) |
| Cihaz hasta sorgusu (Connex Spot → NCE → köprü → API) | `edge/pdq.py`, `edge/pdq_client.py`, `api/edge_query.py` `POST /edge/patient-query` (`MAX_ID` 64) | VM'de (02.11); sahibin NCE oturumu O1–O6 açık |
| Kimlik doğrulama: yerel + AD (LDAP), TOTP, grup eşlemesi | `auth/ldap.py`, `auth/ldap3_directory.py`, `auth/models.py:34` `User` (`auth_source`, `ldap_dn`), `:128` `Group`, `:202` `LdapGroupMapping`; `admin/ldap_router.py` | VM'de (19.10, Grup 1) |
| İzin kataloğu ve gruplar (RBAC) | `auth/permissions.py:19–62` `PERMISSIONS` (board, alerts, admissions.*, care_team.*, handover.sign, shifts.manage, break_glass.use, audit.view, users/groups/structure.manage, devices.*, clinical.chart, scores.sign, beds.release) | VM'de |
| Birim/yatak kapsamı; break-glass | `scope/models.py:30` `StaffScope` (unit_id/bed_id **metin**, FK değil); `scope/rules.py` (atanmamış = kısıtsız, `enforce_unassigned` kapalı); `scope/resolver.py:136` `break_glass_in_tenant`; `escalation/router.py:39` `/break-glass` | VM'de |
| Denetim kaydı: ekle-sadece, kiracı başına hash zinciri; `/audit`, `/audit/verify` | `api/audit.py` (`chain_hash`, `GENESIS_HASH`), `api/audit_postgres.py`, `auth/audit.py`; `api/app.py:1786`, `:1995`; göç `0004`, `0008` | VM'de |
| Bakım ekibi (claim/assign) | `admission/models.py:384` `CareTeamMember`; `admission/router.py:831–872` | API var, **ekran yok** (B1c sonra) |
| Devir (handover) ve nöbet çizelgesi | `admission/models.py:448` `Handover`, `:420` `NurseBedAssignment`; `admission/router.py:1078` `/shift-schedule`, `:1114` `/handovers` | API var, **ekran yok** (roadmap karar 12: çizelgeyi yazan ekran yok) |
| Klinik kayıt: hekim girdileri (vazopresör, sıvı, antibiyotik, GCS), yatak başı vitaller, geri alma | `api/clinical.py`; `api/app.py:999` `/clinical/{id}`, `:1058` preview, `:1161` retract, `:1261` profile | A3 VM'de (26.10); **G3-01 main'de, VM'de değil** |
| Skorlar: NEWS2, SOFA (alarm) ve imzalı SOFA formu | `rules/news2.py`, `rules/sofa.py`, `rules/septic_shock.py`; `scoring/sofa_form.py`, `scoring/signing.py`; `api/app.py:1809`, `:1891`, `:1908` | VM'de (A4, 02.11) |
| Alarmlar: kural motoru, bölümler, onay, eskalasyon döngüsü, bildirim | `api/alert_lifecycle.py`, `api/escalation.py`, `api/ackstore.py`, `api/notify.py`; `api/app.py:1408` `/ack`; `escalation/` Postgres `alerts` tabloları ve `/alerts` rotaları (`escalation/router.py:38`) | Motor tarafı VM'de; `escalation/` Postgres tabloları **VM'de yazılmıyor** (B1a spec §4.4) |
| Monitör–yatak eşleme (veritabanında, denetimli) | `devicebeds/`; göç `0014` | VM'de (02.11) |
| Vital eğrileri, gölge motor (Aşama B), dalga paneli | `api/trends.py`; `api/infinity_shadow.py`, `api/infinity_rules.py`; `edge/infinity_*` | Trendler ve Aşama B VM'de; dalga paneli VM'de değil |

**Olmayanlar (kodda hiç yok):** kişi kaydı (hasta ana kütüğü), ayaktan geliş/muayene, randevu, istem (order),
laboratuvar/radyoloji sonucu alımı, eczane/ilaç uygulama (yalnız vazopresör/antibiyotik *kaydı* var), faturalama,
sigorta, belge/onam yönetimi (yalnız `Patient.consent` enumu, `admission/models.py:133`), rapor/analitik ambar.
Docs'ta da yok: `grep` ile «poliklinik / ayaktan / randevu / fatura / sigorta» yalnız B1d §12'nin tek satırında
geçer.

## 3. Kimlik modeli boşluğu

### 3.1 Sahibin modeli (2026-11-01, B1d spec §1 ve proje hafızası)

Bir kişinin ömür boyu **tek hasta numarası** vardır; her geliş (yatış, muayene, işlem) o numaranın altında **yeni bir
protokol numarası** açar. Saç ekimi bugün, travmatoloji bir yıl sonra: aynı hasta numarası, iki protokol. Yeni hasta
numarası asla verilmez; protokoller hasta numarasından izlenir. İki katman: **kişi** (kalıcı) ve **geliş** (protokol).

### 3.2 Bugünkü kod: dört ayrı anahtar, hiçbiri «kişi» değil

| Anahtar | Nerede | Ne kadar kalıcı | Aranabilir mi |
|---|---|---|---|
| `Patient.patient_number` (`H2600042`) | `admission/models.py:196`; `admission/numbers.py` | **Kabul başına.** `POST /admissions` her seferinde yeni `Patient` satırı açar (`router.py:508`); B1a spec §10: «yeniden yatan yeni numara alır» | Evet (açık, kiracıda tekil :219) |
| `Patient.his_patient_reference` («HBYS protokol no») | `admission/models.py:189–190`; form B1a spec §5.2 | Kabul başına; isteğe bağlı; **Comed'in protokolü** (geliş), hasta numarası değil | **Hayır** — şifreli; `scope/service.py:88` «cannot be filtered» |
| `admissions.protocol_no` (`202600000001`) | `admission/models.py:331`, kısmi tekil dizin `:361`; `protocol/numbers.py` | Geliş başına (doğru katman); nakilde satırdan satıra **taşınır** (`service.py:340–349`, O8: «geliş tablosu HBYS işi») | Evet (açık) |
| `patient_identity.patient_id` | göç `0005` PK `(tenant, patient_id)`; ADT'de PID-3.1 (`edge/adt.py:71`, `:137` ilk tekrarın 3.1–3.3'ü); kabulde kart anahtarı | Comed'in **protokolü** ya da Homunculus'un kart anahtarı; kişi değil | Evet (tam eşleşme) |

Sonuçlar:

- **Kalıcı hasta numarası için kodda hiçbir sütun yok.** Comed'in hasta numarası ne `patients`'ta, ne
  `patient_identity`'de, ne köprü aynasında tutulur. ADT okuması PID-3'ün yalnız ilk tekrarını alır
  (`edge/adt.py:146`); Comed hasta numarasını ikinci tekrarda (ya da başka segmentte) gönderiyorsa bugün atılır —
  **doğrulanmalı** (Comed ADT spec'inin IT soruları, §«Comed / IT'ye sorulacaklar» 3, hâlâ cevapsız).
- **`patients` tablosu adı «kişi», davranışı «geliş».** Aynı kişinin ikinci yatışı ikinci `Patient` satırıdır. Kişi
  tablosu eklenirse bugünkü satırların her biri bir «kişi adayı»dır; aynı kişinin satırları önceden
  birleştirilmiş değildir.
- **Tek «aynı kişi» kuralı A-37'nin `identity_digest`'idir** (`admission/form.py:177`: ad + doğum tarihi anahtarlı
  özet; `admission/models.py:326`, kısmi tekil dizin `:85`). Yalnız ikinci *açık* kabulü reddeder; eski kayıtlara
  bağlamaz, FİN/pasaportu kullanmaz.
- **Protokol doğru katmanda ama yanlış tabloda:** geliş tablosu olmadığı için `admissions`'ta; O8 bunu bir sonraki
  modele erteleyen geçici çözümdür.
- **Comed ile çakışma koruması bugün iki yerde:** `H` öneki (`numbers.py` docstring, «X» olayı) ve yöneticinin
  protokol başlangıcı (B1d D5: Homunculus'un kendi seçtiği aralık eski HBYS'nin protokolleriyle çakışabilirdi).

### 3.3 «Kalıcı hasta numarasını Homunculus verir» ne demek

Her madde sahibin kararıdır; aşağıdaki seçenekler karar değil, çerçevedir.

1. **Kim verir.** (a) Homunculus, kayıt anında (bugünkü protokol gibi, satır kilidiyle); (b) geçiş döneminde Comed
   verir, Homunculus ADT'den alır ve dış kimlik olarak tutar; (c) ikisi birden — çakışma kuralı gerekir. Comed hâlâ
   hasta açıyorsa (a) tek başına yetmez.
2. **Biçim.** B1d protokolde «12 hane, kontrol hanesi yok» dedi (D3) ve cihazdaki *ad* tek güvence sayıldı.
   Hasta numarası farklı bir yerde yaşar: ekranda aranır, yıllarca kullanılır, cihazda ad gösterilmez. Kontrol
   hanesi, uzunluk, yıl öneki, yönetici başlangıcı (D5 modeli) — hepsi açık.
3. **Comed'in mevcut numaralarıyla ilişki.** (a) **Devralma:** Comed'in hasta numarası Homunculus'un hasta numarası
   olur (aynı kişi aynı numara; Comed'den dışa aktarım mümkün mü — doğrulanmalı); (b) **birlikte yaşama:**
   Homunculus kendi numarasını verir, Comed'in hasta ve protokol numaralarını `external_identifiers` gibi bir
   tabloda dış kimlik olarak tutar; (c) **Comed ana kaynak kalır:** Homunculus yalnız yansıtır. B1a D1 («Homunculus
   kabulü asıl kayıt, HBYS yalnız ön doldurur») (b)'ye yakındır; HBYS olmak (a) ya da (c)'yi düşündürür.
4. **Dönen kişiyi eşleştirme (D2 riski).** Yanlış birleştirme (iki kişi tek kayıt) ve yanlış ayırma (bir kişi iki
   kayıt) ikisi de hasta güvenliği sorunudur: alerji, kan grubu ve geçmiş yanlış kişiye bağlanır. Bugünkü kod
   kesin kimlik alanlarını (FİN `national_id`, `passport_no`; `admission/models.py:200–201`) şifreli ve aranamaz
   tutar; eşleştirme için ya aranabilir anahtarlı özet (`crypto.phi_digest` tarzı, `identity_digest` gibi) ya da
   ayrı bir arama dizini gerekir. Çerçeve adayı: tam kimlik eşleşmesi (FİN/pasaport) **öneri**, ad + DOB **aday
   listesi**, **otomatik birleştirme yok**, birleştirme yetkili, denetimli ve geri alınabilir bir işlem. Hangisi
   «aynı kişi» sayılır — sahibin kararı.
5. **Ayaktan gelişler.** Muayene de protokol açarsa (sahip, B1d §12), protokol dizisi yatan/ayaktan ortak mı, geliş
   türü sütunu mu, hangi birimlerde — ve bu, `UnitType`'ın beş YBÜ türünün (`tenant/models.py:23–30`) dışına çıkmak
   demektir.
6. **Açık kabuller ve H-numarası.** VM'de bugün protokolsüz açık kabul yok (02.11 testi kapandı; ileride olabilir).
   H-numarası kalır mı, iç kimliğe mi döner, hiç verilmez mi — eski kartlar H ile anahtarlı (B1d D7).

## 4. Aday modüller

Jenerik HBYS listesi; her satır bir cümleyle «burada ne demek». **ICU-çekirdek** = yoğun bakımın bugünkü işine doğrudan
değer; **hastane geneli** = HBYS olmanın gereği, ICU'nun kendisi için ikincil.

| Modül | Burada ne demek | Sınıf |
|---|---|---|
| Hasta kaydı (ana kütük) | Kişi tablosu + kalıcı numara + kimlik alanları + arama/eşleştirme/birleştirme; bugünkü `patients` satırlarının dönüşümü | ICU-çekirdek **ve** hastane geneli (her şeyin kökü) |
| Ayaktan kayıt ve randevu | Muayene gelişi açma (protokol), poliklinik birimleri, isteğe bağlı randevu defteri | Hastane geneli |
| Yatan ADT (kabul/nakil/taburcu) | Bugünkü B1a + B1d + kapalı nakil (B1b) + geliş tablosu; yataklı servisler YBÜ dışına açılırsa yapı ağacı genişler | ICU-çekirdek (var) → hastane geneli |
| İstem ve sonuçlar (lab, radyoloji) | İstem yazma, LIS/RIS'ten sonuç alma (HL7 ORU/ORM ya da başka), kritik değer; SOFA'nın lab kolları bugün elle (`clinical.py`) | ICU-çekirdek (lab sonucu motoru besler) ve hastane geneli |
| Eczane ve ilaç uygulama | Order → eczane doğrulama → uygulama kaydı; bugün yalnız vazopresör/sıvı/antibiyotik *kaydı* (A3) var; `PHARMACIST` rolü/grubu kodda | Hastane geneli; ICU için ilaç güvenliği (20 madde, Madde 7) |
| Hemşirelik | Bakım planı, görevler, devir; `Handover`/`NurseBedAssignment` modelleri var, ekran yok | ICU-çekirdek (Grup 3 sırasında) |
| Faturalama ve sigorta | Geliş başına hizmet kalemi, fiyat, ödeyici; kodda hiç yok | Hastane geneli; «Azerbaycan'da zorunlu bir sigorta/e-sağlık entegrasyonu var mı? (sahibe sorulacak)» |
| Raporlama | Doluluk, kalite göstergeleri, yönetici özeti; Grup 4'ün alanı | Hastane geneli |
| Belge ve onam | Onam türleri (bugün `Consent` enumu, 2 değer), epikriz, rapor çıktısı, imza | İkisi de |
| Comed entegrasyonu / geçiş | ADT alımı (kod var, akış yok), dış kimlik tablosu, gerekirse ADT/ORU çıkışı, veri aktarımı | Hastane geneli; kimlik modelinin ön koşulu |

## 5. Önerilen ayrıştırma ve sıra

Canlı sistem ve kimlik boşluğu sırayı dayatır: protokol (geliş) var, kişi yok; `patients` her kabulde çoğalıyor; her
yeni modül (ayaktan, istem, fatura) bir kişiye ve bir gelişe bağlanır. Dolayısıyla **kişi önce, geliş hemen
ardından, Comed ilişkisi üçüncü**; ekranlı modüller ondan sonra. Her alt proje kendi spec → plan → dilim döngüsünün
adayıdır. «Canlı koğuşa dokunur» = VM'de göç ya da cihaz/köprü davranışı değişir.

| # | Alt proje | Ne verir | Neye bağlı | Neden burada | Canlı koğuş |
|---|---|---|---|---|---|
| H1 | **Hasta kaydı: kişi ve kalıcı numara** | `persons` (ya da `patients`'ın yeniden tanımı) + kalıcı numara dizisi (yönetici başlangıcı, D5 modeli); kimlik alanları kişiye taşınır; arama (aranabilir özet ya da dizin); FİN/pasaport **öneri**, ad+DOB **aday**, otomatik birleştirme **yok**; birleştirme/ayırma denetimli; mevcut `patients` satırlarının kişi adayına dönüşümü — çoğaltma işaretlenir, **birleştirilmez** | §6 Q1–Q6 kararları | B1d D2'nin açık bıraktığı; her kabul bir kişi satırı daha ekliyor, bekledikçe dönüşüm büyüyor; §4'ün bütün satırları buna bağlanır | **Evet** — göç `0016+`, kabul formu (kişi seç / yeni kişi) |
| H2 | **Geliş (encounter) tablosu ve protokol** | `visits`: protokol buraya taşınır (`admissions.protocol_no` → `visits.protocol_no`), geliş türü (YBÜ yatışı, muayene, işlem), kişiye FK; YBÜ kabulü bir geliş türü olur; nakil aynı gelişte kalır (O8'in geçici taşıması kalkar); açık kabullere protokol (Q7); kart anahtarı protokol kalır | H1 | Ayaktan gelişler ve istemler gelişe bağlanır; O8 spec §7 bunu açıkça HBYS'ye bıraktı | **Evet** — göç; `boardkey.py` davranışı değişmez |
| H3 | **Comed ile ilişki: dış kimlikler ve ADT** | `external_identifiers` (sistem, değer, kişi/geliş); ADT okuması PID-3 tekrarlarını ayırır (hasta no vs protokol); Comed numarası dış kimlik olur; gerekirse Comed'den toplu aktarım; Comed ana kaynaksa Homunculus→Comed çıkışı yok, Comed→Homunculus yansıtma | H1, H2; IT cevapları (`hastane-hl7-omurgasi-analizi.md` §5; Comed ADT spec'in 6 sorusu) | Numara ilişkisi (Q1, Q4) belirlenmeden H1'in biçimi kesinleşemez; köprüde kod hazır, akış hiç gelmedi | **Evet** — köprü imajı, ADT yolu |
| H4 | **Hastane geneli yapı ve roller** | `UnitType`'a YBÜ dışı türler (servis, poliklinik); «kayıt görevlisi» grubu ve `patients.register`/`visits.open` gibi izinler (bugün kabulü hemşire açar, B1a D6); kapsam grantları UUID'ye (D9 «sonra»); AD grupları hastane geneline | H1 | Ayaktan kayıt ve servisler buna ihtiyaç duyar; kataloğa ekleme küçük, enum göçü var | **Evet** (enum göçü) — kabul akışı değişmez |
| H5 | **Ayaktan kayıt (poliklinik) ve etiket** | Kişi ara → geliş aç (protokol) → etiket; randevu isteğe bağlı; cihaz sorgusu ayaktan protokolü de tanır | H2, H4 | İlk «hastane geneli» ekran; en az klinik risk, en çok kullanım | Hayır (yeni ekran; sorgu yolu aynı) |
| H6 | **İstem ve sonuçlar; eczane/ilaç** | Order modeli (gelişe bağlı), LIS/RIS entegrasyonu, kritik değer, eczane doğrulama, uygulama kaydı; lab sonucu SOFA/sepsis kurallarına | H2; LIS/RIS cevapları | Büyük; ICU'ya değeri yüksek ama veri kaynağı (LIS) dışarıda; ikiye bölünebilir (lab önce) | Kısmen (motor girdisi) |
| H7 | **Faturalama/sigorta ve raporlama** | Hizmet kalemleri, ödeyici, fatura; raporlar | H2, H6; Comed'in kaderi (Q1), mevzuat soruları (Q9) | En az ICU değeri; en çok dış kural; Comed faturada kalırsa kapsam dışı | Hayır |

Not: ICU çekirdeğinin işleri (Grup 3 G3-01 dağıtımı, Aşama B, B1b nakil, B1c bakım ekibi) bu sıranın dışında kendi
hatlarında sürer; H1–H2 göçleri onlarla **tek deploy** kuralına girer (hafıza: tek seferde tek VM dağıtımı).

## 6. Sahibe sorular

Her biri bir karar.

1. **Comed'in geleceği:** değiştirilecek mi (Homunculus tek HBYS), beslenecek mi (Homunculus → Comed ADT/ORU), yoksa
   ana kaynak olarak kalacak mı (Comed → Homunculus)? Geçiş dönemi var mı, ne kadar?
2. **Kalıcı hasta numarasını kim verir:** Homunculus mu, geçişte Comed mi, ikisi mi? İkisi verirse hangisi kazanır?
3. **Numaranın biçimi:** kaç hane, kontrol hanesi var mı (protokolde yok, D3), yıl öneki, yönetici başlangıcı (D5 gibi)?
4. **Comed'in mevcut hasta numaraları:** devralınır mı (aynı kişi aynı numara; Comed'den dışa aktarım mümkün mü),
   dış kimlik olarak mı tutulur, yoksa hiç tutulmaz mı?
5. **Eşleştirme kuralı:** dönen kişiyi neyle tanıyoruz? FİN/pasaport tam eşleşme «aynı kişi» mi, öneri mi? Ad + doğum
   tarihi aday listesi mi? Otomatik birleştirme asla mı? Birleştirme/ayırma yetkisi kimde, nasıl geri alınır?
6. **Bugünkü `patients` satırları:** her kabul bir satır; kişiye dönüştürülürken aynı ad + DOB satırlar aday olarak
   işaretlensin mi, dokunulmasın mı?
7. **Açık kabullere protokol** (B1d §12): ileri dönük mü, mevcut açık (H-anahtarlı) kabullere de verilsin mi?
   Verilirse cihazdaki numara ve etiket değişir; H-numarası kalır mı, iç kimliğe mi döner?
8. **Ayaktan kapsam:** poliklinik muayenesi Homunculus'ta açılacak mı, hangi birimlerle başlanır, randevu dahil mi?
9. **Faturalama/sigorta kapsamı:** Homunculus'ta mı, Comed'de mi kalır? Azerbaycan'da zorunlu bir sigorta, e-sağlık
   ya da raporlama entegrasyonu var mı? (sahibe sorulacak; bu belge iddia etmez)
10. **Modül sırası:** H1 → H2 → H3 → H4 → H5 → H6 → H7 kabul mü? H3 (Comed) H1'den önce mi gelmeli (numara ilişkisi
    H1'in biçimini belirliyor)?
11. **Hat (lane) düzeni:** HBYS işi ICU çekirdeğiyle (Grup 3, Aşama B, B1b/B1c) aynı hatta mı, ayrı hatta mı? VM'ye
    tek deploy kuralı korunur mu?
12. **Kayıt görevlisi:** kim hasta kaydı ve ayaktan geliş açar (bugün kabulü hemşire açar, B1a D6)? AD'de hastane
    geneli gruplar var mı?
13. **Comed ADT:** IT'nin cevapları geldi mi (`hastane-hl7-omurgasi-analizi.md` §5; Comed ADT spec'in 6 sorusu)?
    PID-3'ün hangi tekrarı hasta numarası, hangisi protokol? Test ortamı var mı?
14. **Eski gelişlere erişim ve saklama:** taburcu edilen hastanın eski gelişlerine kim, nasıl bakar (B1a A-16 «sonraki
    dilim»); hastane geneli kişi aramanın PHI kuralı ne (yerel bir kişisel veri mevzuatı var mı — sahibe sorulacak)?
15. **Kiracı modeli:** `tenants` çok kiracılı; HBYS tek hastane mi, kurum grubu mu? Site/birim ağacı buna göre kurulur.

## 7. Şimdilik yapılmayacaklar

Oturumdan önce başlanmayacaklar; hepsi §6'nın bir kararına bağlı:

- `patients` / `patient_identity` / `admissions` üzerinde kimlik göçü yok; kişi tablosu, dış kimlik tablosu, geliş
  tablosu kodlanmaz (Q1–Q7).
- Kalıcı hasta numarası için biçim, dizi ya da yönetici ayarı yazılmaz (Q2–Q3).
- `edge/adt.py` PID-3 okuması, köprü aynası ve `api/edge_query.py` değiştirilmez; Comed'e doğru hiçbir çıkış
  (ADT/ORU) yazılmaz (Q1, Q13).
- Otomatik ya da yarı otomatik kişi eşleştirme/birleştirme kodu yazılmaz; `identity_digest` olduğu gibi kalır (Q5).
- Ayaktan kayıt, randevu, istem, eczane, fatura ekranı ya da modeli açılmaz (Q8–Q9).
- `UnitType`'a YBÜ dışı tür, kataloğa HBYS izni eklenmez (Q12).
- Açık kabullere geriye dönük protokol verilmez; `boardkey.py` kuralı değişmez (Q7).
- ICU çekirdeği kendi yolunda sürer: G3-01 dağıtımı, Aşama B, B1b (nakil; O8 protokolü taşıyor, geliş tablosu
  gelince mekanizma sadeleşir — B1b bunu beklemez, not düşer), B1c. B1d'nin açık kalemleri (O1–O7, R1) HBYS'yi
  beklemez.
- Bu belge karar üretmez; oturumun kararları ayrı bir spec'e (`2026-MM-DD-hbys-kimlik-modeli-design.md` adayı)
  yazılır ve roadmap'e HBYS bölümü olarak eklenir.
