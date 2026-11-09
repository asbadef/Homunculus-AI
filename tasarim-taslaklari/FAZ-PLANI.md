# Homunculus HBYS — Tasarım Faz Planı

**Tarih:** 2026-10-21 · **Dal:** `hbys/gelistirme` · **Çalışma alanı:** `tasarim-taslaklari/app/` (tıklanabilir prototip)

## İş bölümü (net)
- **Biz (sahip + ajan):** yalnızca **tasarım/ön yüz** — tıklanabilir, örnek verili ekranlar. Her şey bu prototipin içinde, mantıklı yerleştirilmiş.
- **Arka uç / entegrasyon / gerçek veri:** ekipten başka biri yapar; sahip bu tasarımı ona verir.
- **Döngü:** ajan bir fazı yapar → sahip test eder → eksik/kayma/UX notlarını ajan düzeltir → sonraki faz.

## Kararlar
- Önce **çekirdek + eksikler**, sonra tam HBYS'ye genişle.
- Ekranlar **eskiler gibi tıklanabilir ve örnek verili** (sahip "çalışıyor mu" diye test edebilsin).
- Menü: **sade ray + açılır paneller + "daralt" düğmesi** (gerekirse "Daha fazla" grubu). Kullanım kolaylığı önemli.
- İsimler **Azerice/bize özgü**, rakip adı geçmez. Çok dillilik korunur (AZ varsayılan).
- Prototip kuralı korunur: sistem **tanı koymaz**, **öneri sunar**; ölçek/puan tabloları "hastane onayı gerekir" notuyla.
- **Her özellik iki taraflı yapılır:** (1) kullanıcı ekranı (doktor/hemşire/kabul…), (2) **admin tarafı** — bu özelliğin tanımları ve **hangi rolde hangi yetki** olduğu. Bir ekran eklenince yetkisi de Roller & Yetkiler'de tanımlanır. Sahip hastanede kimin ne iş yaptığını biliyor; roller gerçek görevlere göre kurulur.
- **Gerçek rol gözünden tasarım:** her akış "bu ekranı hasta / doktor / hemşire / kabul / vezne / yönetici gerçekte nasıl kullanır" diye düşünülerek yapılır.
- **Kodlama kuralı:** tüm katalog kodları (hizmet, tanı dışı, bakım…) **bize ait ve sıralı** (00001…). Kaynak/rakip sistemin kodları kullanılmaz (ileride eşleştirme kolay olsun). ICD gibi uluslararası standart kodlar istisnadır.
- **Azerbaycan sağlık sistemi:** Türkiye'ye özgü SUT (EK2A2/EK2B vb.) ve **e-Nabız** gösterilmez; Azerbaycan muadili **TABIB / e-tabib / e-səhiyyə** (tabib.gov.az) araştırılıp uygun yere konur. Fiyat/SUT alanları bu netleşince dolar.
- **Her istem/belge ekranında standart:** **Şablonlar** (şablon ekle / kayıtlı şablonu kullan) ve **Tarihçe** (bu hastanın/alanın geçmiş kayıtları) butonları olacak.
- **Diğer roller de planlanacak:** şu an doktor + admin ağırlıklı ilerliyoruz; sonra kabul, vezne, eczacı, laborant, radyoloji teknisyeni, biyomed, kalite ve hasta akışları eklenecek. Her rolün gerçek görevine göre.

## Rol → yetki haritası (ana hat, geliştikçe dolar)
- **hekim (doktor):** muayene/epikriz yaz, tanı(ICD) seç, **istem** (lab/rad/hizmet), **reçete**, konsültasyon, kontrol. Kendi hastaları + birim kapsamı.
- **hemşire:** bakım planı, hemşire formları, **bakım istemi**, ilaç uygulama/takip, vital giriş, teslim notu. Sorumlu hemşire: birim doluluk/ekip.
- **kabul (ön büro):** hasta kayıt/kabul, randevu, başvuru tipi (ayaktan/yatan/günübirlik), yatak/transfer. Klinik içerik görmez.
- **vezne:** fatura/provizyon/katılım payı, SUT, proforma, tahsilat. Klinik içerik görmez.
- **eczacı:** reçete/istem karşılama, stok/malzeme, etkileşim. **biyomed:** cihaz/kalibrasyon. **kalite:** gösterge/denetim (hasta adı yok). **yönetici/sistem:** tanımlar, roller, hastane yapısı, denetim kaydı.

## Mevcut güçlü yanlar (korunacak)
Hemşirelik/klinik formlar (ağrı, yara/PUSH, Braden, düşme, GCS...), sürümlü bakım planı+katalog, ince yetki/güvenlik, temiz tasarım (tema/yazı boyu/4 dil), cihaz envanteri/kalibrasyon, doluluk, kalite, alarm, kamera, barkod.

## Fazlar (test edilebilir, sırayla)

### Faz 0 — Kullanım kolaylığı / UI omurgası (küçük, görünür)
- Sol menüye **daralt (collapse) düğmesi**.
- Menü düzeni: modüllerin açılır panellerde gruplanması, gerekirse "Daha fazla".
- Genel yerleşim/kayma kontrolü, küçük UX rötuşları.

### Faz 1 — Tanımlar / referans verileri
- ✅ **ICD tanı listesi (14.892)** — `tanı listesi.xlsx` yüklendi; admin'de aranabilir liste + tanı ekle/sil; doktorun tanı seçtiği yere bağlı.
- ✅ **Hizmet kataloğu (20.631 aktif)** — `hizmet listesi.xlsx` yüklendi (`hizmet-veri.js`); İstem ekranı bundan beslenir.
- ✅ **Başvuru tipi** — ayaktan / günübirlik / yatan / yoğun; poliklinik birimi; hasta ekranı tipe göre uyarlanır.
- ✅ **Yeni ekranların AZ/RU/EN çevirisi** eklendi (sözlük). Çeviri eksiklerini doldurmak sürekli görev.
- **Sırada:** Branş listesi, Bölüm listesi (tıbbi bölümler), protokol tipleri, diyet listesi, bakım (hemşirelik) kataloğu, ilaç/malzeme listesi — veri dosyaları geldikçe (ICD gibi dışa aktarımdan).
- Cihaz tanımları: zaten var; "Yönetim > Tanımlar" altında toplanır.

### Sahibin verdiği referans ekranlar (modüllere oturtulacak)
- **İstem** (lab/rad/hizmet): sol katalog ağacı + aranabilir tablo + favori + sepet + açıklama/acil → ✅ yapıldı (katalogdan).
- **Diyet istemi:** öğün bazlı (kahvaltı/öğle/akşam/ara/ek öğün), öğün başına diyet tipi + not + refakatçi + porsiyon; başlangıç tarihi.
- **Bakım (hemşirelik) istemi:** katalog (Qlükometr, Arteriya Baxımı, Decubitus Qulluğu, Yara Baxımı… — kurum bakım listesi), favori, sayfalama.
- **İlaç reçetesi:** reçete türü (yeşil/mor/turuncu/kırmızı/normal), alt tür (taburcu…), ICD tanı bağlama, ilaç satırı (ad/barkod/miktar+birim/sıklık/periyot/kullanım şekli/açıklama türü), e-Nabız/etkileşim sorgu, kaydet+gönder. → ad/etiketler bize özgü.
- Her biri eklenirken **yetkisi** (hekim/hemşire) Roller & Yetkiler'de tanımlanır.

### Faz 2 — Doktor çekirdeği
- **Muayene / epikriz** ekranı (şikâyet, öykü, muayene, tanı/ICD, plan; epikriz şablonu).
- **İstem** (lab / radyoloji / ilaç) giriş ekranı — `orders` yetkisi için ekran yok, eklenecek.
- Hasta tıbbi kartı genişletme, **kontrol/takip** (hekim izlemi).

### Faz 3 — Laboratuvar / Radyoloji iş akışı
- İstem → ödeme → **numune kabul / barkod** → cihaz/PACS → **sonuç onayı** → yetkiye göre görünürlük (tasarım olarak uçtan uca).

### Faz 4 — Hasta kabul + Randevu + Vezne/Faturalama
- Hasta ön kayıt/kabul; **hasta tipleri** (ayakta / yatan / günübirlik).
- **Randevu** (poliklinik / cihaz / diş / FTR...).
- **Vezne paneli** + **kurumsal faturalama** (sigorta/kurum, provizyon, proforma, katılım payı, SUT) — tasarım.

### Faz 5 — Admin / yetki ekranları + geniş tanımlar
- Kullanıcılar, **Roller & Yetkiler** (ince yetki ekranı), Hastane yapısı, Entegrasyonlar, Bildirim kuralları, Bakım kataloğu geliştirme, Denetim kaydı.

### Faz 6 — Mobil + nadir/özel modüller
- Mobil deneyim (doktor/hemşire/hasta).
- Diş tedavi, onkoloji, diyaliz, hematoloji, sterilizasyon, satın alma, stok, CRM, İK, hakediş, dijital arşiv... sırayla.

### Faz 7 — Çok dillilik düzeltme + cila
- Ekran metinlerini **anahtar tabanlı** çeviriye taşıma (teknik borç), tutarlılık, kayma/UX cilası.

## Her faz sonunda
Sahip test eder; eksik, kayma veya UX notu olursa ajan düzeltir; sonra bir sonraki faz. Büyük veri setleri (branş/SUT, hizmet, protokol) **dışa aktarım dosyası** olarak alınır (ICD gibi).
