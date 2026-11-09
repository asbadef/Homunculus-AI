# Homunculus → Rol Bazlı Hastane Sistemi — Yol Haritası (Tasarım Belgesi)

**Tarih:** 2026-10-21
**Durum:** Taslak — sahibin onayı bekleniyor
**Kime yazıldı:** Hem proje sahibi (onay için, teknik olmayan dille) hem de bu işi kuracak geliştirici (planlama için; teknik ayrıntılar en sonda ek bölümde, gerçek kod isimleriyle).

---

## 1. Amaç ve neden

Homunculus bugün bir **yoğun bakım (ICU/NICU) erken-uyarı sistemi**. En zor kısım —
hasta başı cihazları/vital verileri sisteme bağlamak, skor hesaplamak, erken uyarı
üretmek— zaten çözülmüş durumda. Amaç: bu modern çekirdeğin **etrafına**, bir hastanenin
günlük işini yürüten standart süreçleri (muayene, istem, laboratuvar, radyoloji, randevu,
yatan hasta, mali işler, admin...) **rol bazlı** olarak eklemek ve Homunculus'u tam bir
**hastane yönetim sistemine** büyütmek.

**Neden şimdi:** Piyasadaki benzer sistemler geniş ama klasik/eski; modern kısımları
(cihaz entegrasyonu, yoğun bakım skorları, yapay zekâ, temiz tasarım, mobil) sonradan yama
gibi eklenmiş. Bizde bu modern çekirdek zaten var. Yani en zor işi yapmış durumdayız;
standart süreçleri modern bir kabukla sarmak bize rakiplerden **daha iyi** bir ürün çıkarma
fırsatı veriyor.

**Başarı neye benziyor:** Bir doktor/hemşire/vezne/yönetici sisteme kendi kullanıcısıyla
girip yalnızca kendi işini gördüğü, admin'in kimin neyi görüp yapabileceğini tek yerden
yönettiği, hepsi tek ve tutarlı bir Homunculus içinde çalışan bir sistem.

---

## 2. Hedefler, hedef-olmayanlar, kırmızı çizgiler

### Hedefler
- Mevcut Homunculus'un **içinde**, onu bozmadan büyümek (ayrı program yok).
- **Rol bazlı** yapı: her kullanıcı yalnızca kendi ekranlarını görür.
- **Admin/yetki omurgası:** admin rolleri tanımlar, kullanıcıları role atar ve
  "hangi rol hangi ekranı/işlemi görür/yapar" seviyesinde ince yetki verir.
- İlk somut modül: **Doktor** (muayene, istem, hasta kartı, kontrol/takip).
- Sonraki roller aynı kalıpla sırayla eklenir.
- Mobil (doktor/hemşire/hasta) çatıya baştan yazılır, en sona bırakılır.
- Çok dillilik: **Azerice (varsayılan)**, Türkçe, İngilizce.

### Hedef-olmayanlar (şimdilik yapmıyoruz)
- 50 modülün tamamını baştan yapmak. Önce omurga + bir rol, sonra sırayla.
- Yoğun bakım çekirdeğini yeniden yazmak. O çalışıyor; dokunmuyoruz, bağlıyoruz.
- Mobil uygulamaları ilk fazda yapmak.

### Kırmızı çizgiler (bunlar olursa iş başarısız sayılır)
- **Hiçbir yerde rakip/örnek sistem adı geçmeyecek** — ne üründe ne belgelerde.
- **Hiçbir ekran/isim birebir kopya olmayacak.** İsimler **Azerice** ve bize özgü olacak;
  gördüğümüz örneklerdeki adlarla aynı olmayacak. İsimler her adımda sahiple kontrol edilecek.
- **Hasta verisi bu depoda asla tutulmaz** (sentetik/örnek veri hariç).
- **Hastane sınırı güvenliği hiçbir yeni modülde delinmez** (bir hastanenin kullanıcısı
  başka hastanenin kaydını göremez).
- Sistem **tanı koymaz, emir vermez**; "kriter karşılandı / değerlendirilmeli" der. Yeni
  doktor modülü de bu dille yazılır.

---

## 3. Mevcut durum (dürüst resim)

Sistemin bugünkü hâli iki ayrı olgunluk seviyesinde; bunu bilmek yol haritasının
belkemiğini belirliyor:

1. **Arka uç (backend) — olgun ve gerçek.** Gerçek kullanıcı girişi (JWT), çok adımlı
   giriş (MFA), **hastaneye göre roller** (bir kullanıcı birden çok hastanede, her birinde
   farklı rolde olabilir), hastane-sınırı güvenliği ve denetim kaydı hazır. Bugün tanımlı
   **10 rol** var (doktor çeşitleri, hemşire çeşitleri, hızlı yanıt, hastane admini,
   denetçi, platform desteği). **Ama ekran/işlem seviyesinde ince yetki tablosu YOK** —
   onu sıfırdan kuracağız.

2. **Ön uç (frontend) — ikiye bölünmüş.**
   - **Canlı pano** (üretimde kullanılan yoğun bakım ekranı): Bu, hastane başına verilen
     bir **anahtar/token** ile çalışıyor; **kullanıcı girişi yok**, kişi yok, sadece rol
     etiketi var.
   - **Rol bazlı zengin demo:** Tüm rol/yetki/admin deneyimi aslında tarayıcı içinde
     **çalışan bir demo** olarak mevcut (giriş, roller, yetki matrisi, admin ekranları) —
     ama bu demo **gerçek arka uca bağlı değil.** Yani güzel bir maket var, prize takılı değil.

**Bundan çıkan en kritik gerçek:** Omurga işinin büyük kısmı, bu iki dünyayı **birleştirmek**:
gerçek kullanıcı girişini (JWT) ön uca bağlamak, demo'daki rol/yetki mantığını gerçek arka
uca taşımak, ekran yönlendirmesi (router) eklemek ve iki ayrı rol listesi ile iki ayrı dil
sözlüğünü teke indirmek. Yani "önce omurga" kararı sadece mantıklı değil, teknik olarak
**zorunlu** — modüller ancak bu birleşme üstüne sağlıklı oturur.

**İyi haber:** Doktor modülünün bağlanacağı veri zaten var — hasta kimliği, yatış/kabul
kaydı (28 alanlı kabul notu dâhil), hangi doktorun hangi hastaya baktığını tutan **bakım
ekibi** yapısı ve denetim kaydı. Doktor modülü bunların üstüne yeni tablolar ekleyerek oturur.

---

## 4. Kararlaştırılan yaklaşım ("nasıl")

- **Nerede:** Mevcut Homunculus deposunun içinde. Ayrı uygulama yok.
- **Düzen:** Rol bazlı. Giriş ekranı rol kutularıyla açılır; her rol kendi köşesini görür.
- **Sıra:** Önce **ince omurga**, sonra **ilk rol (Doktor) baştan sona**, sonra diğer roller
  aynı kalıpla.
- **İnce omurga ne demek:** Admin'in 50 modüllük tüm yetki ağacını baştan kurmuyoruz.
  Sadece *çalışan mekanizmayı* kuruyoruz: gerçek giriş → rol → yetki → ekran. Benzetme:
  elektrik panosunu ve ilk odayı yaparız; daha yapılmamış odaların anahtarlarını baştan takmayız.
- **İsimler:** Azerice, bize özgü. Tutarlılık için bir **isim sözlüğü** (Azerice terimler
  listesi) tutulur; her yeni ekranın adı oradan gelir ve sahiple kontrol edilir.
- **Mobil:** Çatı mobili baştan hesaba katar (ortak giriş/yetki/arayüz), ama uygulamalar
  en sona kalır.

---

## 5. Omurga (Faz 0) — ne kurulacak

Bu faz görünürde küçük ama en kritik olanı; her modül buna yaslanacak.

1. **Tek rol listesi:** Arka uçtaki roller ile demodaki roller birbirinden farklı. İkisi
   birleştirilip **tek, Azerice adlandırılmış hastane rol listesi** oluşturulur (bkz. Bölüm 7).
2. **Gerçek giriş akışı ön uca bağlanır:** Kullanıcı girer → MFA → sistem onu rolüne göre
   karşılar. Bugünkü "hastane anahtarı" yöntemi yerine kişiye bağlı giriş.
3. **Ekran yönlendirme (router):** Ön uçta gerçek sayfa yönlendirmesi eklenir (şu an URL
   parametresiyle tek ekran seçiliyor).
4. **İnce yetki modeli (yeni, arka uçta):** "Hangi rol / hangi kullanıcı, hangi ekranı
   görür ve hangi işlemi yapabilir" (ör. yazdıramaz, indirim yapamaz, şu formu göremez)
   bilgisini tutan gerçek bir yetki yapısı. Demodaki yetki matrisi buna iyi bir başlangıç
   taslağı. Her yetki kontrolü **denetim kaydına** yazılır.
5. **Admin ekranları (gerçek):** Kullanıcı ekle/düzenle, role ata, role/kullanıcıya yetki
   ver, parametreleri ayarla — hepsi gerçek arka uca bağlı.
6. **Dil birleştirme:** İki ayrı dil sözlüğü tek sözlüğe indirilir; Azerice varsayılan eklenir.

**Omurga bitti sayılır:** Admin gerçek bir kullanıcı açıp ona rol/yetki verebiliyorsa, o
kullanıcı girip yalnızca kendi izinli ekranlarını görebiliyorsa ve her şey hastane sınırına
+ denetim kaydına bağlıysa.

---

## 6. İlk modül (Faz 1) — Doktor

Omurga oturunca ilk gerçek rol dikey olarak yapılır. Doktorla başlıyoruz çünkü hastanenin
kalbi orası, en çok örnek/veri orada ve sahibin en baştan istediği **kontrol/takip
süreçleri** orada.

Kapsam (ilk tur):
- **Muayene** ekranı (şikâyet, öykü, fizik muayene, tanı/ICD, izlem ve plan).
- **İstem** (laboratuvar / radyoloji / ilaç istemi).
- **Hasta tıbbi kartı** (geçmiş gelişler, lab, görüntüleme, dokümanlar — okuma).
- **Kontrol / takip** süreçleri (şu an yalnızca yoğun bakımda olan; genel hastaya açılıyor).

**Önemli — başvuru tipi:** Hasta üç tipte gelir: **ayakta**, **yatan**, **günübirlik**.
Bugünkü yatış kaydı yalnızca yatan hasta için kurulu; bu yüzden üç tipi de kapsayan yeni bir
**başvuru/ziyaret (encounter)** yapısı eklenecek ve "hangi doktor hangi hastaya bakıyor"
yetkisi buna göre kurulacak.

Nasıl bağlanır: Bu ekranlar yeni tablolar ekler; yatan hasta tarafında mevcut **yatış/kabul**
kaydına, ayakta/günübirlik tarafında yeni **başvuru** yapısına ve **hangi doktorun hangi
hastaya baktığını** tutan ilişkiye yaslanır; hastane sınırı ve denetim kuralına uyar. Alt
ekranlar (ör. ağrı formu, özel değerlendirme formları) sahiple birlikte,
talep-tasarla-kontrol döngüsüyle eklenir.

---

## 7. Hedef rol listesi (sahiple kesinleştirilecek)

Başlangıç önerisi (Azerice adları Faz 0'da isim sözlüğüyle netleşecek):

- Həkim (Doktor)
- Tibb bacısı (Hemşire)
- Qəbul / Tibbi katib (Karşılama / Tıbbi sekreter)
- Kassa / Maliyyə (Vezne / Mali işler)
- Laboratoriya
- Radiologiya
- Aptek (Eczane)
- İnsan Resursları (İK)
- Otelçilik / Qonaq xidmətləri (Otelcilik)
- Baş həkim / İdarəetmə (Başhekimlik / Yönetim)
- Admin (Sistem yöneticisi)

Not: Arka uçtaki mevcut 10 rol daha çok yoğun bakım odaklı (doktor/hemşire alt türleri).
Bu liste onları kapsayacak şekilde genişletilecek; eşleştirme geliştiriciye bırakılıyor.
**Sahip:** bu listeye eklemek/çıkarmak istediğin var mı?

---

## 8. Faz sırası (yol haritası)

0. **Omurga** — giriş + rol + ince yetki + admin ekranları + router + dil birleştirme.
   Hasta kimliği bu fazda **FİN**, sigorta/kurum bağlantısı ve **rıza (KVKK/ETK benzeri)**
   alanlarını baştan içerecek şekilde kurulur.
1. **Doktor** — muayene, istem, hasta kartı, kontrol/takip + klinik dokümanlar (epikriz,
   muayene, raporlar; imza ile).
2. **Hemşire.**
3. **Karşılama/randevu + yatan hasta yönetimi.**
4. **Mali işler (vezne/faturalama) + otelcilik + İK.** Vezne tarafı zengin: sigorta
   şirketleri ve kurumsal faturalama, **provizyon/ön onay**, proforma, katılım payı/muafiyet,
   yetkiye bağlı indirimler, hizmet dökümü ve yazdırılabilir **form arşivi**.
5. **Mobil** (doktor, hemşire, hasta).

Her faz bittiğinde sahip kontrol eder; ekleme/çıkarma olursa bir sonrakine geçmeden işlenir.

---

## 9. Geliştiriciye bırakılanlar

- İki rol listesinin ve iki dil sözlüğünün teknik olarak nasıl birleştirileceği.
- İnce yetki modelinin tablo tasarımı (demodaki yetki matrisi taslak alınarak).
- Canlı yoğun bakım panosunun (bugün hastane-anahtarı ile çalışan) gerçek kullanıcı girişine
  **ne zaman ve nasıl** taşınacağı — öneri: Faz 0'da yeni modüller JWT giriş üstüne kurulur,
  canlı pano kısa vadede olduğu gibi kalır, bir köprüyle bağlanır; tam birleşme planlı yapılır.
- Ön uç router seçimi ve ekran iskeleti.
- Doktor modülü tablolarının (muayene/istem/takip) alan tasarımı.

---

## 10. Kararlaştırılan temel sorular (sahip cevapladı — 2026-10-21)

1. **Hasta tipi:** Üç tip birden — **ayakta**, **yatan** ve **günübirlik** hasta. Bugünkü
   yatış kaydı sadece yatan hasta için; zemine üç tipi de kapsayan yeni bir **başvuru/ziyaret
   (encounter)** yapısı eklenecek. Doktor-hasta yetkisi de bu yapıya göre kurulacak.
2. **Lab/Radyoloji/Eczane:** İş akışını **bizim sistemimiz yürütür** (içeriden), cihaz ve
   PACS'tan veriyi çeker. Sahibin anlattığı tam akış Bölüm 11'de.
3. **Dağıtım:** **Çok hastane.** Program farklı hastanelere satılabilir; her hastanenin
   altyapısı/ayarları farklı olabilecek şekilde **parametrik** kurulur. (Mevcut çok-kiracılı
   yapı buna uygun.)
4. **Ortam:** Şu an **test ortamı**, gerçek hasta yok. Çalışma sırasında **test hesapları/
   verileri görünür kılınacak** (hızlı giriş için); en sonda tüm iş bitince test verileri
   **silinecek**.
5. **Pazar:** Birincil pazar **Azerbaycan**, hedef **özel hastaneler/klinikler** (kamuda
   devlet kendi sistemini kullanıyor). Bağlanılması beklenen ulusal yapılar: zorunlu sigorta
   faturalaması (**SAMHI**), ulusal e-sağlık (**e-səhiyyə** + SİMA İmza), **e-reçete**, hasta
   kimliğinde **FİN**, veri koruma (2010 Kişisel Veriler Kanunu). Ayrıntı ve teyit edilecek
   belirsizlikler Bölüm 12'de.

---

## 11. Laboratuvar ve Radyoloji iş akışı (sahibin anlattığı)

İleriki fazlarda yapılacak ama zemini (başvuru, istem, ödeme, görünürlük) Faz 0/1'i
etkilediği için şimdi kaydediliyor.

**Ortak başlangıç:** Hasta gelir → kayıt/vezne hastayı sisteme alır → doktor hastayı kabul
eder, epikriz/muayene yazar, **lab ve/veya radyoloji istemi** açar → hasta vezneye gider,
**ödeme** yapar.

**Laboratuvar:**
1. Vezne hastayı kan alma (hemşire) tarafına yönlendirir.
2. Hemşire **numune kabulü** yapar → sistem bir **numune numarası** üretir → tüpe **barkod**
   basılıp yapıştırılır.
3. Tüp + barkod laboratuvar personeline verilir.
4. Personel tüpü **cihaza** yerleştirir; cihaz çalışır, **sonucu üretir**.
5. Personel sonucu sistemde görür ve **onaylar**.
6. Onaydan sonra sonucu **doktor, vezne, hasta** ve yetkili herkes görebilir.

**Radyoloji:**
1. **Radyoloji kabulü** yapılır; hasta vezneye uğrar.
2. **Tekniker** hastayı kabul eder ("tetkik içeri girdi" butonu).
3. Tekniker **çekimi** yapar; çekim biter.
4. Görüntüler **PACS'a** düşer.
5. Görüntü/rapor **doktorun ekranına** yansır.

**Çıkan roller/işlemler:** kayıt/vezne, doktor (istem), hemşire (numune kabulü + barkod),
laboratuvar personeli (cihaz + sonuç onayı), radyoloji teknikeri (kabul + çekim), PACS/cihaz
entegrasyonu. Anahtar zincir: **istem → ödeme → numune/kabul → barkod → cihaz/PACS → sonuç
onayı → yetkiye göre görünürlük.**

---

## 12. Azerbaycan ulusal sistemleri ve uyum (araştırma özeti)

> Bu bir ön araştırma. En kritik iki belirsizlik — e-səhiyyə'ye bağlanma **yasal
> zorunluluğu** ve e-reçetenin **yaptırımlı zorunluluk tarihi** — resmî kaynaklardan
> (sehiyye.gov.az, e-health.gov.az, SAMHI) doğrudan teyit edilmeli.

- **e-səhiyyə (ulusal e-sağlık portalı):** Merkezî vatandaş sağlık kaydı (e-Nabız benzeri).
  Reçete, rapor, izin, aşı, lab sonuçları buraya akıyor. Kimlik/imza için **SİMA İmza**.
  HBYS'nin buna uyumlu/entegre tasarlanması beklenir.
- **Zorunlu sağlık sigortası — SAMHI:** Tüm nüfusu kapsıyor; ödeme SAMHI'nin merkezî
  talep/fatura (claims) sistemi ve tarife paketi üzerinden. **HBYS buna uygun fatura/talep
  üretebilmeli** (Medula benzeri). Ticari olarak kritik; teknik ayrıntı SAMHI/TƏBİB ile teyit.
- **Hedef pazar — özel hastaneler/klinikler:** Kamu hastanelerinde devletin kendi sistemi
  (E-Tabib HBYS + merkezî PACS) var. Bizim pazarımız **özel sağlayıcılar**; zorunlu sigorta
  kapsamında hizmet verdiklerinde yine SAMHI entegrasyonu gerekir.
- **e-reçete:** 2024'ten beri Elektronik Reçete Platformu + ilaç takip sistemi var. HBYS
  reçeteyi (QR/kayıt no, etken madde bazlı) buraya gönderebilmeli. Zorunluluk tarihi teyit edilecek.
- **Hasta kimliği — FİN:** Hasta ulusal kimlik numarası **FİN** ile tanımlanmalı.
- **Veri koruma:** Kişisel Veriler Kanunu (No. 998-IIIQ, 2010); sağlık verisi "hassas veri".
  Rıza, erişim kontrolü, muhtemel yurt içi saklama/şifreleme. Denetçi: Dijital Kalkınma ve
  Ulaştırma Bakanlığı. (Homunculus'ta PHI şifreleme + denetim kaydı zaten var; üstüne oturur.)

**Tasarıma etkisi:** Bu entegrasyonlar **sonraki fazlarla** (özellikle faturalama ve reçete)
gelir; ama **hasta kimliğinde FİN alanı** ve **veri koruma/rıza** zemini **Faz 0'da** hesaba katılır.

---

## 13. Çalışma ilkeleri (sahip talimatları, 2026-10-21)

- **Tüm tanım/referans verileri sistemde yer alır, bize uygun biçimde.** Bölüm, branş (+SUT/Sağlık Net kodu), cihaz, dönem, protokol tipleri, **ICD tanı listesi (~14.891)** vb. — hepsi doğruluğu korunarak, Azerice ve bize özgü adlandırmayla sisteme girer. Büyük listeler ekran görüntüsünden değil, **dışa aktarım dosyasından** yüklenir (bkz. referans-ekranlar/INDEX notu).
- **Aynı şey tek yerde (DRY).** Aynı veri/işlev farklı modüllere dağıtılmaz; tek bir yerde tutulup her yerden kullanılır. Daha kolay yönetim için tasarım bunu gözetir; gerektiğinde ortak bir "tanımlar" katmanında toplanır.
- **Rol görünürlüğü her adımda düşünülür.** Her ekran ve alan için "hangi rol görür/görmez, ne yapabilir" baştan planlanır (ince yetki modeli — Faz 0 omurgası bunun motoru).
- Plan sağlıklı ve mantık çerçevesinde ilerler; sahip süreçleri gördükçe (localhost) geri bildirim verir.

---

## Ek A — Teknik notlar (geliştirici için; isimler koddaki hâliyle)

**Auth/roller:** `UserRole` (10 değer: ATTENDING, ASSOCIATE_PHYSICIAN, ONCALL_PHYSICIAN,
UNIT_PHYSICIAN, CHARGE_NURSE, NURSE, RAPID_RESPONSE, HOSPITAL_ADMIN, AUDITOR,
PLATFORM_SUPPORT). Roller global değil: `TenantMembership (user_id→tenant_id→role)`.
`roles_by_tenant` her çağrıda DB'den canlı okunur; `ensure_member` (yoksa 404),
`ensure_role_in_tenant(*allowed)` (403). JWT HS256, `JWT_SECRET` zorunlu; access 60dk,
refresh 7g; payload'da `roles` + `mfa_verified`. MFA: `MFA_REQUIRED_ROLES` = AUDITOR hariç
tüm roller; TOTP secret `EncryptedString`(Fernet) ile şifreli. `require_roles` kaba kapı —
tek başına yetmez, kayıt sahibinin tenant'ında `ensure_role_in_tenant` şart.

**Tenant modeli:** Tenant → Site → Unit (`UnitType`) → Room → Bed (`BedState` + geçiş
haritası). Her klinik kayıtta `tenant_id`; yetki kaydın sahibi tenant'ta kontrol edilir;
sınır dışı erişim 404.

**Yetki (mevcut):** Arka uçta yalnızca kaba rol kontrolü; ekran/işlem yetki tablosu yok.
Ön uç demoda `PERMISSION` enum + `ROLE_PERMISSIONS` + `roleCan` (sadece istemci tarafı).
Yeni gerçek model bunun şeklini arka uca `role_permissions` benzeri bir tabloya taşıyıp
`ensure_role_in_tenant` çağrı noktalarında kontrol etmeli. Allow/deny → `security_audit`.

**Ön uç:** Router yok; `main.jsx` URL paramıyla tek kök seçer (`Board.jsx` üretim /
`ClinicalDemo.jsx` demo / `demo.jsx` replay). Üretim panosu `api.js` üzerinden legacy API
(`/patients`, SSE `/stream`, `/ack`, `/notifications`, `/audit`) ile konuşur, `VITE_BOARD_TOKEN`
ister, kullanıcı girişi yoktur. Rol/yetki/admin deneyimi `clinicalDemo.js` içinde (ağ yok).
Demo rolleri backend'den farklı (RRT vs RAPID_RESPONSE, PHARMACIST/BIOMEDICAL eklenmiş,
doktor alt türleri yok) — birleştirme gerekli. Navigasyon: `ClinicalDemo.jsx` NAV dizisi
(`{key,icon,roles,group}`, `canSee`) — doktor modülü sekmesi için doğal ekleme noktası.
i18n iki ayrı sözlük (`i18n.js` `LANGS=[tr,az]` + `clinicalI18n.js`); birleştirilip az
varsayılan yapılacak.

**Doktor modülü için veri:** `admission/models.py` — `Patient` (PHI, `EncryptedString`,
`tenant_id`), `Admission` (`AdmissionState` makinesi, 28 alanlı kabul notu, `icd10_codes`
JSONB, `attending_physician_id`), `CareTeamMember` (`CareTeamRole`, on-call pencereleri) =
hangi doktor-hangi hasta kapısı, `NurseBedAssignment`, `Handover`. `Observation` ORM değil,
`canonical.py` içinde dataclass (in-memory vital sinyali). Yeni modül tabloları `Admission` +
`tenant_id` FK'li, `CareTeamMember` ile kapsanmış, `security_audit`'e yazan şekilde eklenir.

**API:** `api/app.py` `create_app` hem yeni JWT/DB routerlarını (`/auth`, `/tenant`,
`/admissions`, `/alerts`, `/break-glass`) hem legacy in-memory board API'yi (token→hospital
map) kurar. İki paralel kimlik sistemi var; yeni modüller sistem (2) JWT üstüne kurulur.
Stratejik boşluk: canlı pano hâlâ sistem (1); birleştirme yol haritasının omurgası.
