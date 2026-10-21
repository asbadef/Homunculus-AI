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

## Faz L — iş kuralları (sahibin verdiği mantık)
- **L6. Hasta No ≠ Protokol No:** Hasta No **tektir** (FİN'e bağlı, aynı hasta her gelişte aynı numarayı taşır). **Protokol No her gelişte yenilenir.** (Örn. hasta no 0000001 sabit, protokol 0000154 her gelişte değişir.) Aynı FİN tekrar gelince: aynı hasta no + yeni protokol.
- **L7. Protokol Aç/Kapat + fatura kilidi:** Protokol **Kapalı** ya da **fatura kesildi** ise o protokole kimse (doktor dahil) **işlem/hizmet/istem ekleyemez** (kilitli). Vezne/yetkili açıp kapatır.
- **L8. Özel Onay = ödeme alındı:** Bir işlemin "özel onay"ı, ödemesinin alındığını gösterir. Hekimin iş listesinde ödeme yapılmamış/eksik hasta için uyarı; ödeme/özel onay olmadan ilgili işlem bloklanır.
- **L9. Yazdır çıktıları menüsü:** Epikriz, Hasta barkod, Kabul bilgi formu, Muayene formu, Onam formu, Refakatçi formu, Hizmet dökümü, Taahütname, Tetkik istem, Proforma, Protokol barkod, SGK hizmet dökümü, Patoloji istek, Poliklinik rıza, Order raporu… düzenli tek menüde.
- **L10. İşlem Havuzu sağ-tık:** Doktor/Tarih/Tutar/Paket/Yeniden fiyatlandır/Durum (bekleyene at, iptal, fatura kesilmeyecek)/Özel onay/Yazdır/Diğer/Seçim.

## Faz M — Vezne derinliği + rol/yetki bağlama (sahibin verdiği)
- **M0. Her özellik bir role/yetkiye bağlı** (çapraz ilke): admin'de rol → yetki. Örn. **Kampanya oluşturma** yetkisi olan rol kampanyayı oluşturur; **vezne** yalnız oluşturulmuş kampanyayı **seçer**. Roller sahibin listesinden.
- **M1. Vezne Kasası / Dönem:** Vezne çalışmaya başlarken **banko** (Yatan/Estetik/Pediatri/Preop/Eczane/Ofis… kasası) + **dönem** seçer; tüm işlemleri o dönem+banko altında kaydedilir. Dönem **Aç / Kapat / Devir Al**. Ödemeler **kart/nakit/havale** olarak o banko altında takip edilir.
- **M2. Fiyat Verme:** bölüm-doktor + SGK/sigorta + kampanya/indirim seçip hizmet/malzeme/lab/radyoloji ekleyerek **hasta/SGK/ÖSS/AK/toplam** fiyat; Teklifler.
- **M3. Kampanyalar:** kampanya tanımı (ad, tip, uygulama tipi, tarih, geliş/protokol/kurum/bölüm/doktor/yaş/cinsiyet kapsamı, kalemler=sabit fiyat/formül, hasta grupları). Yetkili rol oluşturur.
- **M4. GFK Takip:** protokollerin fatura durumu (Hasta faturası kesilmiş / Kurum faturası kesilmiş / Provizyonu alınmamış…) + filtre; fatura kesildi/kesilmedi kontrolü.
- **M5. Evrak Takip:** fatura evrak teslim (veznede/teslim edildi/medikal muhasebede/iade) + sağ-tık (teslim et, geri al, tarihçe).
- **M6. Sağ Vezne 360 / İş Havuzu paneli:** Hasta/Randevu arama, Son hastalar, Reçete listesi, Onay bekleyen indirim/iade, Medula, Toplu fatura, Protokol listesi, Fiyat teklifleri…

## Not
Bu faz uzun; parça parça yapılıp commit'lenecek. Sağ panel "Vezne 360" en görünür parça; L1/L2 (kabul formu + admin seçenekleri) önce, çünkü diğerleri buna bağlı.
