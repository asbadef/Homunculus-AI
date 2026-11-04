# Hasta Mobil Uygulaması — Tasarım Belgesi

**Tarih:** 2026-11-04
**Durum:** Taslak — sahibin onayı bekleniyor
**Kime yazıldı:** Hem proje sahibi (onay için, teknik olmayan dille) hem de bu işi kuracak
geliştirici (teknik ayrıntılar en sonda Ek A'da, gerçek kod isimleriyle).
**Bağlam:** Bu belge, [[2026-10-21-hastane-sistemi-yol-haritasi-design]] yol haritasındaki
**Faz 5 — Mobil** işinin hasta tarafının tasarımıdır.

---

## 1. Amaç ve neden

Homunculus'un büyüdüğü hastane sisteminin (HBYS) **hastaya bakan yüzü**: hastanın randevu,
sonuç, reçete, fatura gibi işlerini tek yerden gördüğü bir **"hastane cebimde"** telefon
uygulaması. Doktor/hemşire paneli hastane içindi; bu uygulama hastanın kendisi için.

**Neden şimdi:** Arka uç (randevu, sonuç, reçete modülleri) henüz yapılıyor. Ama uygulamanın
**görünüşünü ve akışını** şimdiden kurup sahibin üstünde gezerek karar vermesi, sonraki tüm
modülleri doğru şekle sokar. O yüzden önce **gerçeğe çok benzeyen, nümunə (örnek) verili bir
maket** çıkarıyoruz; arka uç hazırlandıkça ekranlar teker teker gerçek veriye bağlanır.

**Başarı neye benziyor:** Hasta uygulamayı açıp FİN'iyle girer, randevusunu alır, sonucunu
görür, reçetesini ve faturasını takip eder; yakını yoğun bakımda/yeni doğanda ise durumunu
izler — hepsi tek, temiz, bize özgü bir uygulamada, Homunculus'un tasarım diliyle.

---

## 2. Hedefler, hedef-olmayanlar, kırmızı çizgiler

### Hedefler
- Hastanın en çok kullandığı işleri (randevu, sonuç, reçete, fatura) tek uygulamada toplamak.
- **Zengin ve görsel** bir deneyim (sahip bu tarzı beğendi): hikâye daireleri, kampanya
  afişleri, görseller, kart tabanlı ana ekran.
- Homunculus doktor/hemşire panelinin **renk ve tasarım dili** (turkuaz marka, aynı aile).
- **Varsayılan aydınlık tema**, kullanıcı isterse koyu moda geçer.
- **Çok dillilik:** Azərbaycan (varsayılan), Türkçe, Rusça, İngilizce.
- **Özellik ekle/çıkar kolay olsun:** ana ekran ve menü tek bir yapılandırma listesinden
  beslenir; bir özelliği açmak/kapamak = tek satır.
- Önce **maket** (nümunə veri, Expo'da telefonda gezilebilir), sonra sırayla **gerçek veriye
  bağlanma**.

### Hedef-olmayanlar (şimdilik yapmıyoruz)
- **"Sağlığım"** (adım/nabız/uyku, akıllı saat verisi) ilk sürümde yok. Sonraya; geldiğinde de
  veri cihazdan beklenmez, **kullanıcı elle girer**.
- **Görüntülü görüşme (video)** en sona (teknik olarak en ağır parça).
- Gerçek ödeme/sigorta (SAMHI) entegrasyonu ilk maket turunda yok; önce ekran/akış, bağlantı
  sonraki fazlarda.

### Kırmızı çizgiler (bunlar olursa iş başarısız sayılır)
- **Hiçbir ekran/isim birebir kopya olmayacak.** Liv/MLP uygulaması yalnızca **fikir** için
  incelendi; ekran adları ve metinler **Azerice ve bize özgü** olacak, örnekteki adlarla aynı
  olmayacak. İsimler bir **isim sözlüğünden** gelir ve her adımda sahiple kontrol edilir.
  (Yol haritasının kırmızı çizgisiyle aynı kural.)
- **Hiçbir yerde rakip/örnek uygulama adı geçmeyecek** — ne üründe ne belgede.
- **Hasta verisi bu depoda asla tutulmaz** (sentetik/nümunə veri hariç).
- **Hastane sınırı güvenliği delinmez:** bir hasta yalnızca kendi (ve bağladığı yakınlarının)
  verisini görür; yanlış kişi başkasının sağlık verisini göremez.
- **Sistem tanı koymaz, emir vermez.** Özellikle "sonucu sade dille açıkla" özelliği
  "kriter/değer genelde şu demek, doktoruna danış" dilinde yazılır; tanı cümlesi kurmaz.
- **Hassas ekranlarda ekran görüntüsü/kaydı engellenir** (gizlilik).

---

## 3. Kararlaştırılan yaklaşım ("nasıl")

Sahip **A yöntemini** seçti:

1. **Tarayıcı maketi:** Liv zenginliğinde ama bizim renklerimizle, hızlı ve anında
   düzeltilebilir bir maket. Sahip beğenene kadar üstünde oynanır.
2. **Expo'ya taşıma:** Beğenilen maket bire bir Expo (React Native) uygulamasına taşınır;
   sahip telefonunda açar.
3. **Gerçek veriye bağlanma:** Arka uç modülleri (doktor, lab, randevu...) hazırlandıkça
   ekranlar teker teker nümunə veriden gerçek veriye geçirilir.

Elenen yollar: **B) Doğrudan Expo'da başlamak** (her küçük deneme yavaş döner), **C) Figma**
(ayrı araç, kod çıkmaz, sahip kullanmıyor).

### Tasarım dili
- Renkler/temalar Homunculus panelinden: marka turkuaz `#0891b2`, yazı tipi Figtree ailesi.
  Varsayılan **aydınlık**; **gün/gecə** düğmesiyle koyuya geçiş (panelin "icu/gece" moduna
  akraba koyu tema).
- **Zengin ve görsel:** ana ekranda hikâye daireleri + kampanya afiş karuseli + büyük kısayol
  kartları + "Hızlı Servisler" ızgarası + "Güzel haberler / Sağlıklı bilgiler" şeridi.
- **Görsel üretimi:** Bu kadar görsel (afiş, hikâye, makale, ikon) için bir görsel üretme aracı
  (Gemini/Nano Banana ya da bir image-gen MCP) bağlanır. Maket aşamasında yer tutucu/örnek
  görsel kullanılır; sahip onayladıkça gerçeği üretilir.

---

## 4. Uygulamanın ekranları (tam liste)

Hepsi önce **maket (nümunə veri)**, sonra işaretlendiği sıraya göre gerçek veriye bağlanır.

### Giriş ve açılış
- **Tanıtım (onboarding):** 4-5 slayt — uygulama ne yapar.
- **Giriş/kayıt:** Ülke seç (vars. Azərbaycan) → FİN (yabancı: pasaport) + doğum tarihi +
  telefon → **SMS kod** → sonraki girişlerde **PIN / parmak izi / yüz**.
- **Rıza (KVKK):** İlk açılışta tek seferlik sağlık verisi onayı.
- **Dil seçimi:** Giriş ekranından itibaren AZ/TR/RU/EN.

### Ana ekran (Ev)
- Karşılama + profil kısayolu + dil + **gün/gecə**.
- **Hikâye daireleri** (duyuru/tanıtım), **kampanya afiş karuseli**.
- Büyük kısayollar: **Randevu, Nəticələr, Reseptlər, Faturalar** (ilk sıradakiler, tek listeden).
- **Hızlı Servisler** ızgarası: Sağlık kartı, Aşı kartı, Dokümanlar, Nöbetçi eczaneler, Yakındaki
  hastaneler, Yakınımı ekle, Check-up, Yakın takibi.
- **Güzel haberler / Sağlıklı bilgiler** makale şeridi.

### Randevu
- **4 adımlı sihirbaz:** Hastane (mesafe, "seçmeden devam et") → Bölüm (ikonlu) → Doktor
  (arama, favori, en yakın saat) → Tarih/Saat (takvim + saat ızgarası).
- **Randevu tipi:** yüz yüze / online (video, sonraya) / "asistan benim için ayarlasın".
- **Kendim / başkası (yakınım) için.**
- **Özet + onay** penceresi; **ödeme tipi** (sigortalı/sigortasız) seçimi.
- **Doktor özgeçmişi:** foto, unvan, eğitim, tecrübe, üyelikler. → **Veri HBYS'den gelir** (bkz. §5).
- **Randevularım:** liste, erteleme/iptal.

### Sonuçlar (Nəticələr)
- Filtre: Laboratuvar / Radyoloji / Patoloji; protokol no, hastane.
- **Detay:** değer + **referans aralığı** + **normal/anormal işareti** + zaman içindeki **trend
  grafiği** (sadece PDF değil). PDF görüntüle.
- **Sade dille açıkla (AI):** değeri hastanın anlayacağı dille özetler — **tanı koymaz,
  "doktoruna danış" der** (bizim kozumuz, Homunculus'a bağlı).
- **Belge yükleme:** dışarıda yapılan tahlil/raporu fotoğrafla ekle.

### Reçeteler (Reseptlər)
- Liste; **ilaç detayı:** barkod, kullanım şekli, aç/tok, etiket uyarıları, prospektüs.
- **İlaç hatırlatıcı** ("20:00 hapını al"); eczaneye göster.

### Diğer
- **Sağlık kartı:** kan grubu, alerji, kronik hastalıklar — elle girilir, acil için.
- **Yakın takibi (kozumuz):** yakını **yoğun bakım / yeni doğan** (ileride ameliyat) servisinde
  olan aile, durumu/ziyaret saatini izler — **isimler maskeli, rıza şartıyla.**
- **Faturalar/ödeme:** borç, kart ekle, öde.
- **Profil:** kişi (FİN maskeli), **aile üyeleri** (yakının FİN'i + doğum tarihiyle ekle), dil,
  tema, bildirim tercihleri, çıkış.
- **Bildirimler:** "randevun yarın", "sonucun hazır".
- **Muayene sonrası kısa anket**, check-up paketleri, canlı destek/mesaj.

### Alt menü (sabit)
5 sekme: **Ev · Randevu · Nəticələr · Sağlıq · Profil** (adlar isim sözlüğüyle kesinleşecek).

### Sonraya bırakılanlar
- **Sağlığım** (adım/nabız/uyku) — geldiğinde **elle giriş**, cihaz beklemeden.
- **Görüntülü görüşme (video).**

---

## 5. Veri nereden geliyor (admin bağlantısı)

Sahibin vurguladığı kritik nokta: **patient app, HBYS verisinin bir görünümüdür.**

- Admin/doktor modülü bir **doktoru** sisteme ekler (özgeçmiş, foto, bölüm, çalışma saati) →
  hasta app'te o doktor randevuya çıkar.
- **Hastane/bölüm/doktor dizini** HBYS'den beslenir (tek kaynak, DRY).
- Lab/radyoloji personeli sonucu **"onayla"** deyince → hastanın app'inde görünür.
- Vezne faturayı üretir → hastanın app'inde "ödenecek" olarak görünür.

Yani **"admin olarak neler işimize yarayacak"** sorusunun cevabı: admin, hasta app'in
içeriğini yöneten yer. Hangi doktorun randevuya çıkacağı, hangi kampanya afişinin görüneceği,
hangi haberin yayımlanacağı adminden kontrol edilir. (İnce yetki modeli — Faz 0 omurgası —
bunun motoru.)

---

## 6. Bizim farkımız (kozlar)

1. **AI sonuç yorumu**, klinik çekirdeğe (Homunculus) bağlı ve **tanı koymayan** dille.
2. **Yoğun bakım / yeni doğan yakını takibi** — rakiplerde yok; çekirdeğiniz tam buna uygun.
3. **Kolay ekle-çıkar** (tek yapılandırma listesi).
4. **Hassas ekranlarda ekran kaydı engelleme.**
5. Tek ve tutarlı tasarım dili (panelle aynı aile).

---

## 7. Fazlar (uygulamanın kendi yol haritası)

- **M0 — Maket:** Tüm ekranlar nümunə veriyle, önce tarayıcıda sonra Expo'da gezilebilir. Giriş
  akışı, diller, rıza, tema, tüm ana ekranlar "çalışıyormuş gibi".
- **M1 — İlk gerçek bağlanma:** Omurga (Faz 0 giriş/yetki) ve doktor dizini hazır olunca randevu
  sihirbazı + doktor özgeçmişi + sonuç listesi gerçek veriye bağlanır.
- **M2 — Sonuç/reçete/fatura derinleşir:** Trend grafiği, AI yorum, ilaç detayı, ödeme.
- **M3 — Kozlar:** Yakın takibi (YBÜ/yeni doğan), sonra video görüşme ve Sağlığım.

Her faz bittiğinde sahip telefonda kontrol eder; ekleme/çıkarma olursa bir sonrakine geçmeden
işlenir.

---

## 8. Geliştiriciye bırakılanlar
- Expo proje iskeletinin nereye kurulacağı (öneri: `mobile/patient/` veya ayrı paket).
- Panelin tasarım token'larının (renk/tipografi) React Native'e taşınma biçimi (Tailwind
  sınıfları RN'de çalışmaz; ortak token nesnesi gerekir).
- Nümunə veri katmanının biçimi (panelde `demoTransport.js` deseni gibi) ve gerçek API'ye
  geçişin ekran ekran nasıl yapılacağı.
- Hasta kimlik/giriş akışının (FİN + SMS) arka uçta nasıl kurulacağı — mevcut JWT **personel**
  içindir; hasta girişi **yeni** bir yol (bkz. Ek A).
- İsim sözlüğü (Azerice ekran/sekme adları) — sahiple kesinleşir.

---

## Ek A — Teknik notlar (geliştirici için; isimler koddaki hâliyle)

**Mevcut tasarım kaynağı:** `dashboard/` (React + Vite + Tailwind). Tema motoru
`src/clinicalTheme.js` (`THEME_KEYS=[light,icu,contrast,wall]`, token'lar tam Tailwind sınıf
dizgisi). Marka `tailwind.config.js`: `brand #0891b2` (500: `#22d3ee`), `sev.*` önem renkleri,
font `Figtree`. i18n iki sözlük: `src/i18n.js` (`LANGS=[tr,az]`) + `src/clinicalI18n.js`.
Navigasyon deseni: `ClinicalDemo.jsx` içindeki NAV dizisi (`{key,icon,roles,group}`, `canSee`)
— **config-driven menü** için örnek alınacak kalıp.

**Mobil taraf:** Expo / React Native. Tailwind sınıfları RN'de geçmez → `clinicalTheme`'deki
token'lar **ortak bir JS token nesnesine** (renk/aralık/tipografi ölçeği) çevrilip hem RN hem
ileride web paylaşabilir. Ana ekran + alt menü **tek bir ekran kayıt listesinden** üretilir
(`{key, title, icon, screen, enabled, order}`), böylece "ekle/çıkar tek satır" hedefi tutar.

**Kimlik/giriş (ÖNEMLİ boşluk):** Mevcut `auth/` (JWT HS256, `UserRole` 10 personel rolü,
`TenantMembership`, MFA/TOTP) **personel** içindir. **Hasta girişi yeni bir yol:** FİN/pasaport +
doğum tarihi + telefon → SMS OTP → cihazda PIN/biyometri. Hasta, personel rol sistemine
girmemeli; ayrı bir "patient" kimlik/oturum katmanı gerekir (hasta ↔ `Patient` kaydı eşleşmesi,
`tenant` sınırına ve `security_audit`'e bağlı). SMS sağlayıcısı (Azerbaycan) seçilecek.

**Veri:** `admission/models.py` — `Patient` (PHI `EncryptedString`, `tenant_id`), `Admission`
(28 alanlı kabul notu, `icd10_codes`, `attending_physician_id`), `CareTeamMember` (hangi doktor-
hangi hasta). Randevu/sonuç/reçete/fatura tabloları **çoğunlukla yok** → app önce yerel mock
transport ile çalışır (web'deki `demoTransport.js` deseni), modüller açıldıkça gerçek endpoint'e
geçer. Doktor dizini: admin/doktor modülündeki doktor + özgeçmiş + çalışma saati kayıtlarından.

**Hasta-tarafı API (henüz yok, açılacak):** `/patient/auth` (FİN+SMS), `/patient/appointments`
(hastane/bölüm/doktor dizini + slot), `/patient/results`, `/patient/prescriptions`,
`/patient/invoices`, `/patient/family`. Hepsi hasta oturumuna ve `tenant` sınırına bağlı,
`security_audit`'e yazar.

**Gizlilik:** Hassas ekranlarda ekran kaydı engelleme — `expo-screen-capture`
(`preventScreenCaptureAsync`). Çok dillilik: mobil kendi sözlüğünü tutar, **AZ varsayılan**.

**Çözülecek sorular (sahip onayından sonra plana girer):** SMS sağlayıcı; hasta kimlik
modeli; doktor dizini endpoint sözleşmesi; isim sözlüğü; görsel üretme aracının bağlanması.
