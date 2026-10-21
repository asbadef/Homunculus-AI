# HBYS — Faz Planı 3: Vezne / Kayıt derinleştirme (onaylandı · yapılıyor)

Sahip: kayıt süreçleri eksik; admin panelleri/listeleri rahat düzenleyebilmeli; vezne 360 panelleri önemli; daha düzenli (çeviri/yerleşim). Vezne görselleri gelmeye devam edecek.
Tarih: 2026-10-22 · Dal: `hbys/gelistirme`

## Faz L — Vezne / Kabul / Kayıt

- **L1. Hasta Kabul protokol formu** (ayaktan + yatan): Geliş tipi (Ayaktan/Günübirlik/Yatan), **Protokol tipi** (Genel muayene/Preop/Kontrol/Laboratuvar/Radyoloji/Check-up/Donör), **Bölüm-Doktor** seçimi, **Erişim kanalı** + alt kanal, Danışman, **SGK/Özel sigorta**, Anlaşmalı kurum, Kampanya/Şirket, Misafir/Nöbetçi doktor, **Tercih sebebi**, Triaj/112, Bağlı protokol, Yeni doğan, KDV muaf.
- **L2. Admin'den düzenlenebilir kayıt seçenekleri** (sahibin en çok istediği): **Erişim kanalı, Tercih sebebi, Protokol tipi, Geliş tipi** vb. listeler admin'den eklenir/düzenlenir/silinir → formlar bu listelerden beslenir. (Genel "Kayıt Seçenekleri" tanım ekranı.)
- **L3. Vezne hasta-360 paneli**: Faturalar · Ödemeler/Avanslar · İndirimler sekmeleri + sağ **Vezne 360 / İş Havuzu** panelleri (Hasta arama, Son hastalar, Reçete listesi, Onay bekleyen indirim/iade, Medula, Toplu fatura, Protokol listesi…).
- **L4. İşlem / İstek Havuzu**: hastanın tüm işlemleri (lab/rad/ilaç/hizmet) fatura-bekleyen listesi + **Ekle** (hizmet/ilaç/tetkik/ameliyat) + sağ-tık (fatura/iptal/yeniden fiyatlandır/durum).
- **L5. Yatış Planlama**: medikal yatış/ameliyat/yoğun bakım/müdahale + ameliyat bilgileri (anestezist/ameliyathane/süre/zorluk) + hizmet/malzeme/kan sekmeleri. (İstem ameliyat formuyla birleşecek.)

## Değişmez
Kendi kodlarımız/isimlerimiz · Azerbaycan muadili (SAMHI/TABIB) · her özellik iki taraflı · admin düzenleyebilir · düzenli çeviri+yerleşim.

## Not
Bu faz uzun; parça parça yapılıp commit'lenecek. Sağ panel "Vezne 360" en görünür parça; L1/L2 (kabul formu + admin seçenekleri) önce, çünkü diğerleri buna bağlı.
