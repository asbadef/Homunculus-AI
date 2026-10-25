# Doktor (Klinik) Süreç Analizi — 35 Eğitim Videosundan

> Kaynak: Pusula BAK (MLP Care) HBYS doktor/klinik eğitim videoları (35 adet).
> Bu belge referans sistemin DOKTOR iş akışını karelerden çıkarır. Amaç: kendi
> HBYS'mizin (asbadef / homunculus prototipi, Azerbaycan pazarı) doktor modülünü
> buna göre kurmak. Ekran adlarını birebir KOPYALAMIYORUZ — mantığı alıyoruz,
> kendi Azerice adlarımızı/görsel kimliğimizi kullanıyoruz.
>
> **Azerbaycan uyarlaması:** Türkiye'ye özgü entegrasyonlar BİREBİR alınmaz:
> Medula/SGK → **SAMHI / İcbari Tibbi Sığorta**, e-Nabız → **TƏBİB / e-tabib**,
> e-reçete (TR) → Azerbaycan reçete akışı. Bu noktalar belgede `[AZ]` ile işaretlidir.
>
> **Yöntem notu:** Her video için ffmpeg ile 4 sn'de 1 kare çıkarıldı (ffmpeg 9.0.2,
> kurulu). Kareler Read ile incelendi, bölüm yazıldıktan sonra silindi. PHI/hasta
> verisi analize alınmadı; sadece ekran/akış mantığı.
>
> Son güncelleme: 2026-10-25

---

## 0. Doktor modülünün çekirdek mantığı (her şeyin temeli)

Referans sistemde doktorun dünyası **Hasta → Protokol (geliş) → Muayene Kartı → İstem/Order → Sonuç → Epikriz** zinciridir:

1. Doktor kendi **iş listesi / hasta listesi** üzerinden çalışır (bekleyen hastalar, randevulular, yatanlar). Vezne protokolü açar, hasta doktorun listesine düşer.
2. Her hasta gelişi bir **protokol**e bağlıdır; doktor o protokol için bir **muayene/hasta kartı** açar.
3. Doktor karttan **istem** (order) yapar: laboratuvar, radyoloji, ilaç (order), konsültasyon, ameliyat, yatış, taburculuk. İstemler vezne/hemşire/ilgili birime düşer.
4. **Sonuçlar** (lab, radyoloji görüntü, patoloji, konsültasyon cevabı) doktora geri gelir.
5. Doktor **epikriz / rapor / gözlem notu** yazar, reçete düzenler, dökümanları yönetir.

Tekrar eden kalıplar: **favori/şablon** (sık kullanılan istem/order setleri), **tarihçeden aktarma** (önceki gelişten veri kopyalama), **footer/alt menü hızlı erişim**.

---

## 1. Genel hasta arama + doktor iş listesi (Video 1)

**Ekran:** Doktorun ana giriş noktası = **İş Listesi** (hasta çalışma tezgâhı).

- Üst grid = bekleyen hastalar. Sütunlar: **Protokol Bilgileri**, **Laboratuvar** (ör. 0/0), **Radyoloji**, **Gider**, **Finansal Kontrol** (ör. "Finansal Kontrol Uygun"), **İşlem Bilgileri** (ör. "Genel cerrahi muayenesi" + durum "Bekliyor" + saat). Her satırda hasta adı, yaş/doğum, protokol no, sigorta (ör. "SGK Yurtiçi").
- Üst filtre şeridi: tarih aralığı, **Menuel İş Listesi**, **Randevular**, **Tıbbi İkinci Görüş**, **Epikriz İşlemi** sekmeleri.
- **Hasta arama kutusu** + kapsam seçimi **Benim / Bölümün / Tümü** + **Ayrıntılı Filtre**. Arama kriterleri: Ad, Soyad, Hasta No, Kimlik No.
- Arama sonucu grid: Ad Soyad, Cinsiyet, Doğum Tarihi, Baba Adı, Hasta No, Özel Durum.
- Hasta seçilince alt panelde **protokol/geliş geçmişi**: Protokol Tarih, Protokol No, Şube, Protokol Durumu (Açık/Kapalı), Protokol Tip (Genel Muayene/Ameliyat/Kontrol), Geliş Tip (Ayaktan/Yatan), Bölüm-Doktor, Kapanış Tarih. "Protokol Açma" aksiyonu mevcut.
- Bir protokol açılınca **Muayene Kartı** gelir (Video 5'te detaylı). Sağ kenarda doktor modülü ana menüsü: **Tüm Gelişler, İşlem, Laboratuvar/Görüntüleme, Patoloji, Yatış, İşlem Tarihçesi, Ameliyat Raporu, Konsültasyon, Dokümanlar, Protokol İşlem, Takip, Hasta Takip, Bakım Planı, Randevular**. Alt (footer) sağda **e-nabız** düğmesi `[AZ: TƏBİB/e-tabib ile değişir]`.

**Çıktı/sonuç:** Doktor hastayı bulur, gelişini/protokolünü seçer, muayene kartına girer. Bu ekran doktor modülünün "çatısı"dır.
