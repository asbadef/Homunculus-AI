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

## Mevcut güçlü yanlar (korunacak)
Hemşirelik/klinik formlar (ağrı, yara/PUSH, Braden, düşme, GCS...), sürümlü bakım planı+katalog, ince yetki/güvenlik, temiz tasarım (tema/yazı boyu/4 dil), cihaz envanteri/kalibrasyon, doluluk, kalite, alarm, kamera, barkod.

## Fazlar (test edilebilir, sırayla)

### Faz 0 — Kullanım kolaylığı / UI omurgası (küçük, görünür)
- Sol menüye **daralt (collapse) düğmesi**.
- Menü düzeni: modüllerin açılır panellerde gruplanması, gerekirse "Daha fazla".
- Genel yerleşim/kayma kontrolü, küçük UX rötuşları.

### Faz 1 — Tanımlar / referans verileri
- **ICD tanı listesi (14.891)** — `tanı listesi.xlsx`'ten yüklenip aranabilir liste; doktorun **tanı seçtiği** yere ve **bakım kataloğuna** bağlanır (kod → ad).
- **Branş (+SUT), protokol tipleri** tanım ekranları (veri dosyaları geldikçe dolar).
- Cihaz tanımları: zaten var; "Yönetim > Tanımlar" altında toplanır.

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
