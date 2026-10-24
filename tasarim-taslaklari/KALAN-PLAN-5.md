# HBYS — Faz Planı 5: Tanım ekranları, hizmet yönetimi, raporlar (2026-10-24)

Sahibin verdiği 7 madde + görseller. Geri alma YOK, kaldığımız yerden devam. Dal: `hbys/gelistirme`.
Çapraz ilke: her özellik yetkiye bağlı (admin tarafı her konuşmada kontrol+eklenir) · kendi kod/isimlerimiz (görseldeki başlıkları birebir kopyalama) · Azerbaycan (SAMHI/TƏBİB, **Medula yok**) · ekranlar birbirine bağlı (bölüm↔randevu↔hizmet↔otomatik tanım) · ileride mobil · çeviri eksikleri sürekli kontrol.

## Faz R — Hasta erişimi ve protokol düzenleme (Madde 1)
- ✅ R1. Hasta arama: isme tıkla → hasta bilgi kartı (telefon/FİN/kurum/doktor…) + filtre. "360" yazısı kaldırıldı.
- ✅ R1b. "Medula" yazıları kaldırıldı → Provizyon.
- R2. Protokol düzenleme: protokolü **sil**; bölüm/doktor/tarih **değiştir**; doktorun girdiği hizmetlerin **tarihini değiştir**. Hepsi yetkiye bağlı (admin'de yeni izinler).
- R3. Çeviri eksikleri taraması (AZ/TR/RU/EN).
- R4. Diğer liste ekranlarında da tıkla-aç + filtre (genel desen).

## Faz S — Bölüm/Branş tanımı zenginleştirme (Madde 2)
- S1. Daha çok bölüm + çeviri. Bölüm **kodu**. Admin tanımlar → kullanıcıda görünür.
- S2. Zengin bölüm kartı (görsel): Kısa/Yabancı/Alternatif ad, Bölüm Tipi/Alt Tipi, Branş, bayraklar (Randevu verilir, Hasta farkı almaz, İndirim otomatik onaylanmaz, Epikriz bölüme özel, Katılım payından muaf, Fiyat teklif veren bölüm, Mobil chekin/ön ödeme…), SGK hasta fark oranı, Bölüm sorumlusu, İrtibat telefon, Ventilatör sayısı, Masraf merkezi, Muayene ekranı, Şube, Rapor adı + Epikriz şablonu (ayaktan/yatan) + Randevu bilgileri.

## Faz T — Epikriz şablonu (Madde 3)
- T1. Admin epikriz şablonu: alanlar (Şikayet, Hikaye, Özgeçmiş, Bulgular, Tedavi ve Bakım Planı, Tanılar, Gözlem Notu, Rad.Sonuç, Ameliyat Notu, Ameliyat, Lab.Sonuç, Konsültasyon, Kan İstek…) → Epikriz Dahil (aç/kapat), Sıra No, Başlık, Boş ise çıkmasın.
- T2. Şablon listesi (Ayaktan/Yatan/Yoğun Bakım/FTR/Özet…). Doktor epikrizde bu şablona göre bölümleri görür.

## Faz U — Randevu tanımları (Madde 4)
- U1. Bölüm Randevu Tipi: Randevu Tipi (Muayene/Kontrol/Sonuç Gösterme/Online…), Ad, Süre, Doktor, Çalışma Saati, Renk, Protokol Tipi, Hizmet, Fiyat, Bilgilendirme Tipi, Fiyatı tarifeden al, Web default. Bölüme bağlı.
- U2. Randevu ↔ bölüm ↔ protokol tipi ↔ hizmet bağlarını kur.

## Faz V — Otomatik hizmet tanımı (Madde 5)
- V1. Mevcut ekranı görsele göre zenginleştir: Hizmet, Bölüm, Doktor, Doktor Hariç, Kurum Tipi, Kurum, Geliş Tipi, Protokol Tipi, Provizyon Tipi, Paket İçeriklerini Aktar, Randevudan Kabul Edildiğinde Düşsün. (İsimleri kendimizce.)

## Faz W — Hizmet yönetimi tek merkez (Madde 6)
- W1. Hizmet Fiyatları ekranını **tüm hizmetlerin listesi** olarak kur (tek tek arama yerine). Fiyat/kurum sütunları, düzenle.
- W2. Hizmet kartı (zengin, görsel): Kod, Ad, Yabancı Ad, Tip/Alt Tip, Fiyat+KDV, Maliyet, İndirim yetki kodu, Doktor seçim tipi, KDV muafiyet, Mesaj konusu, Rapor bölümü, Patoloji tipi, Süreler, Özellikler (Teklifte çıkmasın, Tam zorunlu, Paket), Randevu, SUT yerine kendi kod alanları + sağ sekmeler (kategoriler, bağlı işlemler, paketler, tarifeler, kurallar). Yeni hizmet tanımı aynı karttan. **Tek noktadan** yönetim.

## Faz X — Raporlar derinleştirme + rol yetkisi (Madde 7)
- X1. Rapor sayısını artır (görsellerdeki menüler: Hasta Kabul, Tedavi, Yatan, Medikal Finans, Laboratuar, Tetkik/Radyoloji, Randevu, Finans, Stok, Satınalma, Yönetim, Kurum).
- X2. Her rapor: tarih/bölüm/doktor filtresi + tablo + **Excel'e aktar**.
- X3. **Rol bazlı rapor yetkisi**: admin hangi rolün/kullanıcının hangi raporu göreceğini belirler (modül+rapor bazlı izin).
- X4. Rapor "arkası": her raporun hangi veriden geldiği (kaynak/filtre mantığı) kayıtlı.

## Not
Çok büyük; parça parça yapılıp commit'lenecek. İlaç/malzeme listesi gelince Faz Y (eczane/stok) eklenecek.
