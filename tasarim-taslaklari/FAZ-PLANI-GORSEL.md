# HBYS — Görsel Faz Planı (tüm ekranlar, bu sohbetteki her görsel) · 2026-10-25

**Yöntem (sahip onayladı):** her ekran için *çıkar → onayla → birebir yap*. **İlke:** kapsam/fonksiyon birebir, görsel kimlik tamamen bizim (kendi düzen/renk/isim/ikon; "360" vb. rakip markalama yok; emoji yok; renkli nokta/SVG). **Öncelik: VEZNE önce bitecek, sonra diğer modüller.** Medula her yerde kaldırılır (Azerbaycan). Entegrasyonlar (Omnitech/SAP/VNA/ComedEMR/UHM) etiketli yer tutucu. Kendi kod/isimlerimiz.

## KARAR GEREKEN (sahip ile konuşulacak, plan ilerledikçe)
- K1. **Kabul modülü + Vezne birleşmesi:** Sol paneldeki "Kabul" ile vezne aynı işi yapar oldu. Tek isim altında ("Vezne / Kabul" ya da "Ön büro") birleştirilsin mi? Kullanıcı buradan doktora kayıt açınca doktor görür mantığı.
- K2. **Vezne açılışı:** Vezneye tıklayınca doğrudan fatura/ödeme takip açılmasın; **hasta arama/kabul** ekranına açılsın. (Yapılacak.)
- K3. **"+ Yeni" üst bar:** sağ üstteki + Yeni menüsü (hasta/randevu/kabul/personel…) süreçleri netleşsin.
- K4. **KVKK/ETK onayı → SMS/e-posta:** tasarımı şimdi, gerçek gönderim çok sonra (ayrı ekip).

## FAZ V — VEZNE (ÖNCELİK, önce bitecek)
Görseller: Vezne Paneli, Hasta Dosyası (11 alt sekme), İş Havuzu, Hasta Ön Kayıt, Hasta Kabul, Kasa/Dönem.
- ✅ V0. Hasta Dosyası iskeleti + Hasta Kartı sekmesi (bizim kart düzeni) · isim "Hasta Dosyası" · emoji kaldırıldı.
- V1. **Vezne Paneli** birebir: üst bar (Banko/Dönem/Tarih), sol çoklu arama + arama detay, hasta listesi (Durum/Hasta No/Kimlik/Ad/Soyad/Baba/Anne/Doğum/SGK/ÖSS/AK/Telefon/Pasaport/Güvenlik Seviyesi), sağ ray (bizim isimlerle). Açılışta arama/kabul (K2).
- V2. **Hasta Ön Kayıt** ekranı + sağ-tık (Birleştir, Hasta Kabul→Poliklinik/Acil/Günübirlik/Yatış/Kontrol/Donör, Yeni Doğan, Protokol Bilgileri).
- V3. Hasta Dosyası alt sekmeleri birebir: **Gelişler** (geliş/hekim/arşiv/kurum/takip/yurtdışı/yatış kartları + toolbar), **Faturalar** (sütunlar + sağ-tık), **Ödemeler/Avanslar** (toolbar + sağ-tık + İade/Para Üstü/Virman), **İndirimler**, **Dosyalar/Resimler**, **Notlar**, **Teklifler** (Ameliyat/Tüm + teklif hizmetleri + sağ-tık), **Online Ödemeler**, **POS**, **Anlaşmalarım**.
- V4. **İş Havuzu** sekmesi: İstek Havuzu, **İşlem Havuzu tam** (toolbar Fatura/Parçalı/İndirim/Provizyon/Ekle/Panel Paket + Fatura Bekleyen/Tümü + sol kurum toplamları + sağ-tık tam menü), Provizyon Takip, Randevular, Yatış İstekleri, Onam Formları, Tetkik Havuzu, Arşiv, Yeni Randevu.
- V5. **Kasa / Dönem**: banko seç + dönem Aç/Kapat/Devir Al; tüm işlemler dönem+banko altında; ödeme kart/nakit/havale.
- V6. Toolbar tam: Hasta Kabul menü, Diğer menü (16+ madde), Yazdır, Müstehaklık, **KVKK/ETK onay → SMS/mail tasarımı (K4)**.

## FAZ T — TEDAVİ / DOKTOR
- T1. Tedavi sekmesi: Klinik Dokümanlar, Laboratuvar, Radyoloji, Patoloji, Tanılar, Diş Tedavi Planları, Aktarım, Reçete İlaç Listesi.
- T2. Doktor iş listesi → istem (tetkik/radyoloji/ilaç/hizmet) → epikriz (şablona göre). (Çoğu var; görsele göre elden geçir.)

## FAZ A — ADMIN / YETKİ / TANIMLAR
- A1. **Güvenlik Tanımları** birebir: Kullanıcı kartı (Personel, Açılış Ekranı, Kullanıcı Grubu, Şube, Kioks Pini, Erişim Bilgileri SMS/ComedEMR) + sekmeler **Yetkiler / Formlar (modüller) / Roller / Değerler (veri izinleri)** + **Yetki Kopyalama** (Roller/Form/Veri/Fonksiyon). (userModal zenginleştirildi; görseldeki 4 sekmeli yapı kurulacak.)
- A2. **Personel kartı** birebir: Genel / Kişisel / Nöbet-Mesai-İzin / Eğitim-Tecrübe / Çalışma Takvimi (haftalık + Randevu Özellikleri) / Yakınları / Zimmet / Diğer. (Çoğu var; takvim görünümü eklenecek.)
- A3. Tanımlar (çoğu ✅, görsele göre elden geçir): Bölüm (idari+klinik) · Protokol Tipi · Hizmet Kartı/Fiyatları (birleşik ✅) · Otomatik Hizmet Tanımı · Epikriz · Kampanya · Doküman · Mesaj Kalıpları · Kayıt Seçenekleri · Rapor Yetkileri.
- A4. **İzleme** (görsel): Log İzleme, Kullanıcı İzleme, Yetki İzleme, Değişken Log, Yetki Log, Açık Oturumlar, Finansal Veri İzleme. (Bir kısmı var.)

## FAZ R — RAPORLAR
- R1. İstatistik ve Analizler menüsü birebir (modül bazlı ~tüm başlıklar) + öncelikli raporların içi + filtre + Excel/Yazdır. (Başlıklar ✅, içerik birikecek.)

## FAZ G — GENEL / ÇERÇEVE
- G1. Sol panel (modül ağacı) — düz, başlıksız ✅ (sahip onayladı). İleride modül erişimi yetkiye göre.
- G2. **"+ Yeni" üst bar** (K3): hasta/randevu/kabul/personel/talep hızlı aç.
- G3. Üst bar: rol gözüyle bak, dil, tema, bildirim, saat/nöbet ✅ (var).
- G4. Çeviri turu (4 dil) — sürekli; yeni metinler biriktirilir.
- G5. İş Takip / Destek ✅.
- G6. PWA / mobil — ileri faz.

## SIRA (self-approve · sahip onayı beklenmeden ilerlenir)
V (vezne tamamı) → T (tedavi/doktor) → A (admin/yetki) → R (raporlar) → G (çerçeve kalan).
Her ekran: çıkar-onayla-yap. Büyük ekranlarda önce iskelet+1 sekme (tasarım yönü onayı), sonra kalan sekmeler.

## GÖRSEL ENVANTERİ (bu sohbette verilen — hiçbiri atlanmayacak)
Admin: güvenlik tanımları (kullanıcı/yetki/form/rol/değer/kopyalama), izleme menüsü, personel kartı tüm sekmeler, idari+klinik bölüm listesi, modül ağacı (sol panel).
Vezne/Hasta: Hasta Ön Kayıt, Vezne Paneli, Hasta Dosyası (Kart/Gelişler/Faturalar/Ödemeler/İndirimler/Dosyalar/Notlar/Teklifler), İş Havuzu (İstek/İşlem/Randevular/Yatış/Arşiv), Tedavi, sağ-tık menüleri (fatura/ödeme/indirim/dosya/not/teklif/işlem havuzu).
Tanım: protokol tipi (bayraklar), hizmet kartı, otomatik hizmet tanımı, bölüm randevu tipi, epikriz şablon, randevu özellikleri.
Her biri yukarıdaki fazlara dağıtıldı.
