# Form envanteri — durum (formlar.xls'e göre) · 2026-10-25

**Kaynak:** `formlar.xls` (sahibin Homunculus'a koyduğu liste) = referans HBYS'nin (Pusula) **tüm form envanteri**.
- **3188 benzersiz form** · 1194 ana menü + ~2000 diyalog/alt form.
- Bu, bir hastane **ERP + HIS**'inin tamamıdır (stok, eczane, satınalma, hakediş, sterilizasyon, laboratuvar, radyoloji, CRM dahil). Hiçbir tıklanabilir tasarım prototipi bunu birebir 3188 ekran olarak yapmaz; bu dosyayı **ana kontrol listesi** olarak kullanıp **önceliğe göre** ilerliyoruz.
- Ham liste: `FORM-ENVANTERI.txt` · modül dağılımı: `FORM-ENVANTERI-MODUL.txt`.

## Modül sayımları (benzersiz form)
| Modül | Form | Kapsam |
|---|---:|---|
| Tedavi / Muayene / Doktor | 377 | **BİZİM** |
| Vezne / Tahsilat | 346 | **BİZİM** |
| Admin / Tanım / Güvenlik / Sistem | 239 | **BİZİM** |
| Rapor / İstatistik | 136 | **BİZİM (kısmi)** |
| Medikal Muhasebe / Kurum | 86 | **BİZİM** |
| İK / Personel | 70 | **BİZİM** |
| Yatan / Hemşire / Bakım | 67 | **BİZİM (başka modülde var)** |
| Randevu | 62 | **BİZİM** |
| Hasta Kabul / Ön büro | 57 | **BİZİM** |
| Stok / Eczane / Satınalma | 299 | kapsam dışı (ayrı ekip) |
| Laboratuvar | 145 | kapsam dışı / ileri |
| Hakediş / Muhasebe / ERP finans | 143 | kapsam dışı |
| Radyoloji / Tetkik | 83 | kapsam dışı / ileri |
| E-Nabız/E-İmza/Kiosk/Mobil/Entegrasyon | 68 | kapsam dışı |
| Sterilizasyon / Biyomedikal / Cihaz | 39 | kapsam dışı (Cihaz Listesi var) |
| Kalite / Enfeksiyon / Memnuniyet | 14 | kapsam dışı / ileri |
| Diğer (vendor/niche: Acıbadem, Allianz, Apache II, 112 vb.) | 957 | büyük kısmı kapsam dışı |

---

## Kapsam-içi modüller · yaptıklarımız / öncelikli eksikler

### Hasta Kabul / Ön büro (57)
- **Yapıldı:** Hasta Ön Kayıt, Hasta Kabul (poliklinik/yatış/günübirlik/kontrol/donör), Hasta Kartı (360), Protokol bilgileri, KVKK/ETK onay, Hasta birleştirme (bağ), Kurum değişiklik (rail), Bilinmeyen hasta kaydı.
- **Öncelikli eksik:** Hasta Uyarı, Refakatçi, Hasta Sevk, Kara Liste, HES/Müstehaklık sorgu, Araç plaka, Toplu hasta kayıt.

### Vezne / Tahsilat (346 — çoğu alt diyalog)
- **Yapıldı:** Vezne Paneli, Hasta 360 (Gelişler/Faturalar/Ödemeler-Avanslar/İndirimler/Dosyalar/Notlar/Teklifler/Online/POS/Anlaşmalarım), İş Havuzu (İstek/İşlem/Provizyon/Randevu/Yatış/Onam/Tetkik/Arşiv), Fiyat verme, **Kurumsal Faturalama**, İndirim onay, İade onay, GFK takip, Evrak takip, Dönem/Devir/Kasa özeti, tahsilat.
- **Öncelikli eksik:** fatura tipleri (parçalı/proforma/büyük boy), makbuz/çıktı, POS entegrasyon ekranı, kupon, avans virman detay, provizyon ekranları. *(Sahip vezne kurgusu için görsel gönderecek → buna göre.)*

### Medikal Muhasebe / Kurum (86)
- **Yapıldı:** Medikal Muhasebe hub (menüde), kurum bazlı açık alacak, kurumsal faturalama kısayolları.
- **Öncelikli eksik:** kurum mutabakatı, e-fatura, dönem icmali, kurum anlaşma/tarife tanımları, hakediş bağı.

### Tedavi / Muayene / Doktor (377)
- **Yapıldı:** Tedavi sekmesi → Klinik Dokümanlar (muayene/izlem/ameliyat raporu/anestezi/onam editörü), **branşa özel muayene formları** (Göz + 7 branş), **Tanılar (ICD ara-ekle)**, Laboratuvar/Radyoloji/Patoloji/Reçete görünümü, doktor istem tarih/doktor düzenleme (yetkili), Epikriz Şablonu.
- **Öncelikli eksik:** istem/order tam akışı (istek→işlem→sonuç), konsültasyon ekranı, ameliyat planlama/notu formları, multidisipliner konsey, çok sayıda skala/form.

### Yatan / Hemşire / Bakım (67 — mevcut klinik modülde)
- **Yapıldı:** Yatak paneli (vital/skor), hemşirelik formları, bakım planı, vardiya devri, alarmlar, yatak başı ölçüm, doluluk.
- **Öncelikli eksik:** order uygulama takibi, bazı risk/skala formları (düşme, bası yarası detay).

### Randevu (62)
- **Yapıldı:** Randevu ekranı, yeni randevu (**doktor çalışma takvimi + "poliklinik/web randevusu verilebilir" bayrağına göre filtre**), bölüm randevu tipleri.
- **Öncelikli eksik:** takvim/çizelge görünümü (gün/hafta grid), web randevu ekranı, slot kapatma UI, randevu teyit.

### İK / Personel (70)
- **Yapıldı:** Personel kartı (10 sekme: Genel/Kişisel/Nöbet-Mesai-İzin/Eğitim/Çalışma takvimi/Yakınları/Zimmet/Diğer/İletişim/Yetkiler), İK listesi.
- **Öncelikli eksik:** izin/işgöremezlik akışı, kadro, nöbet çizelgesi görünümü.

### Admin / Tanım / Güvenlik / Sistem (239)
- **Yapıldı:** Kullanıcılar, Roller ve Yetkiler (matris + kopyalama), **Güvenlik Tanımları** (yetki/form/rol/değer + ağaç seçim), Hastane yapısı, Bölüm/Branş, Protokol Tipi, Hizmet Kartı/Fiyat (zengin sekmeli), Otomatik Hizmet, ICD, Diyet, Bakım, Kampanya, Doküman Tanım, Epikriz Şablon, Mesaj Kalıp (SMS), Cihaz Listesi, Parametre, Kayıt Seçenekleri, Bildirim kuralları, Sistem durumu/izleme/denetim.
- **Öncelikli eksik:** tanım listeleri (ülke/il/ilçe, ölçü birimi, numaratör, yatak tipi, para birimi detay), entegrasyon detay ekranları.

### Rapor / İstatistik (136)
- **Yapıldı:** Raporlar (sahibin verdiği 6 grup, ~18 rapor örnek veriyle + filtre + Excel + yazdır).
- **Öncelikli eksik:** kalan rapor içeriklerinin örnek veriyle doldurulması, grafik/özet panoları.

---

## Nasıl ilerliyoruz
1. Sahip ekran görüntüsü gönderdikçe ilgili formu bu listede işaretleyip yapıyoruz (öncelik: Vezne kurgusu).
2. Kapsam dışı modüller (stok/eczane/satınalma/hakediş/lab/radyoloji iç ekranları) ayrı ekip / ileri faz.
3. "Diğer/niche" (vendor-özel, Apache II gibi klinik skorlar, 112) gerekmedikçe yapılmaz.
