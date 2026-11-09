# HBYS — Faz Planı 4: Derinleştirme ve diğer roller (taslak · onay bekliyor)

Tarih: 2026-10-22 (gece) · Dal: `hbys/gelistirme`
Önceki fazlar (1–3) büyük ölçüde bitti: vezne (fatura/fiyat/indirim/iade/gfk/evrak + 360 ray), kampanya, doküman tanımları, zengin protokol tipi, hizmet fiyatları, raporlar menüsü, granüler yetkiler, hasta no≠protokol no, özel onay, çok kademeli onay zinciri, işlem havuzu sağ-tık, doküman tarihçesi, randevu geçmişi.

## Değişmez kurallar
Kendi kodlarımız/isimlerimiz · Azerbaycan muadili (SAMHI/TABİB) · her özellik iki taraflı (kullanıcı + admin) · her buton/alan bir role/yetkiye bağlı · admin düzenleyebilir · düzenli çeviri+yerleşim · kullanıcı teknik değil.

## Faz N — Derinleştirme

### N1. Protokol tipi bayraklarının TAM davranışsal etkisi
Şu an: bayraklar tanımlı (admin), vezne fiyatta hastaFark/sgkKatilim etkisi var, istemde bilgi şeridi var.
Yapılacak: bayrakların akışa tam bağlanması —
- `otoKapanma` (otomatik kapanmasın): protokol gün sonunda otomatik kapanmaz.
- `avans` (avans alınabilsin): vezne hastadan avans alabilir (avans ekranı).
- `islemHavuz` (işlem havuzuna düşsün): eklenen istemler vezne işlem havuzunda görünür.
- `doktorsuz` / `nobetsiz`: doktor/nöbet zorunluluğu kalkar.
- `kvkkMuaf`: KVKK onayı istenmez.
- `sira` (muayene sıra no): kayıtta sıra numarası üretilir.
Not: Zamanlayıcı/otomasyon gereken kısımlar (otomatik kapanma) backend işi; prototipte düğme/işaret ve "gün sonu" simülasyonuyla gösterilir.

### N2. Klinik doküman form şablon motoru (derin içerik) — EN BÜYÜK İŞ
Şu an: admin'de doküman tanımları (ad/grup/kategori) var; içerik yok.
Yapılacak:
- Admin'de her doküman için **alan şablonu** (başlık, alan tipi: metin/sayı/seçim/çoktan seçmeli/tarih/imza, zorunlu mu).
- Doktor/hemşire belge açınca bu şablondan **doldurulabilir form** üretilir (docs.js ile entegre).
- Öncelikli ~15-20 form araştırmayla gerçek alanlarıyla hazırlanır (ör. Cerrahi Güvenlik Kontrol Formu = WHO 3 aşama; Ağrı Formu; Düşme Riski; Glasgow; Aydınlatılmış Onam; ÖSS Taahhütnamesi…).
- Azar azar, form form ilerler.

### N3. Raporların içi + gerçek filtre
Şu an: ~10 rapor örnek/özet veriyle; diğerleri "yapım aşamasında".
Yapılacak: her raporda tarih/bölüm/doktor filtresi + tablo + Yazdır/Dışa aktar (CSV). Kalan başlıklar sırayla.

### N4. Yazdır çıktıları düzenli menü
Şu an: yazdir.js'te sabit şablonlar (kol bandı, barkod, epikriz…).
Yapılacak: hasta/doküman ekranlarında tek "Yazdır" menüsü — Epikriz, Hasta barkod, Kabul formu, Muayene formu, Onam, Refakatçi, Hizmet dökümü, Taahütname, Tetkik istem, Proforma, Protokol barkod, SGK hizmet dökümü, Patoloji istek, Order raporu. Doküman tanımlarına bağlanır.

## Faz O — Diğer roller ve ekranlar

### O1. Mevcut ekranların düzeltmesi
Mantık akışı incelemesinde çıkan bulgular (yetki tutarsızlığı, kırık link, maskeleme ihlali, çalışma-anı riski) sırayla düzeltilir.

### O2. Diğer roller için eksik ekranlar
Sahip diğer rollerin (eczane, laboratuvar/radyoloji teknisyeni, satın alma, stok, sterilizasyon, hakediş, CRM, dijital arşiv, e-Nabız/entegrasyon, medikal muhasebe) görsellerini verdikçe eklenir. Her biri: kullanıcı ekranı + admin/yetki tarafı.

### O3. İşlem Havuzu tam ekranı
Hastanın tüm işlemleri (lab/rad/ilaç/hizmet) fatura-bekleyen listesi + sağ-tık (zaten vezne fiyatta örnek var) + toplu işlem.

## Faz P — Altyapı

### P1. PWA derinleştirme
Şu an: pwa.js temel (service worker kaydı). Yapılacak: çevrimdışı önbellek, "ana ekrana ekle", telefon bildirimleri, mobil yerleşim denetimi.

### P2. Fiyat/fatura matematiği
Hizmet fiyatı + kurum anlaşması + kampanya + SGK katılım + KDV + avans/iade → tutar hesabının tutarlı motoru (şu an temsili). Backend ekibiyle ortak kurgu.

## Sıra önerisi
1) O1 (inceleme düzeltmeleri) — kalite önce.
2) N1 (protokol tipi tam etki) + N3 (rapor filtreleri) — başlananları bitir.
3) N2 (doküman şablon motoru) — büyük, azar azar.
4) N4 (yazdır menü), O3 (işlem havuzu), P1 (PWA).
5) O2 — sahip görsel verdikçe.
