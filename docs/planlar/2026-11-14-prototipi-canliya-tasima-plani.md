# Prototipi canlıya taşıma planı

**Tarih:** 2026-11-14 · **Sahip:** Ozan · **Yürüten:** Claude (Asaf arka planda inceliyor)
**Kaynak:** `localhost:5180` (HBYS prototipi, `_asbadef-prototip/repo/tasarim-taslaklari`) → **Hedef:** `172.100.101.72:8080` (`dashboard/src/live`)

## Kurallar (her adımda)

1. **Görünüm birebir.** Sahibin verdiği ekran görüntüsündeki yerleşim, renk, yazı, düğme, boş durum, menü davranışı aynen.
2. **Hasta verisi sistemden gelir.** Prototipteki hasta kayıtları, sabit sayılar ("37 geciken iş", "laktat 4.1") ve rastgele çizgiler canlıya konmaz; aynı kutu/çizgi gerçek veriyle dolar, veri yoksa kutu bunu söyler.
3. **Tanım ve katalog içerikleri gerçek içeriktir.** Hizmet listesi, ilaç listesi, ICD, diyet, bakım istemleri, branşlar, yasal metinler, şablonlar prototipten alınıp sistem tanımı olarak yüklenir (sahip kararı, 2026-11-14).
4. **Asaf'ın güvenlik bilgileri silinmez.** Alarm, NEWS2 ayrıntısı, eski veri, doğrulanmamış monitör gibi bilgiler prototip düzenine sığmazsa "Ayrıntılar" altına katlanır.
5. **Her adım:** prototip görüntüsü ↔ canlı görüntü karşılaştır → kodla → testler (4.500+) → VM'e yayın (yedekli, `.claude/vm-yayin.sh`) → canlıda ekran görüntüsüyle doğrula → `asbadef/main`'e gönder.

## Durum

| | İş | Durum |
|---|---|---|
| ✅ | Giriş ekranı (sahne, hareketler, bayraklar, yasal sayfalar, sosyal ikonlar, şeffaf logo) | canlıda |
| ✅ | Yatak paneli: bölümler, boş yataklar, kart düzeni, Hasta kabul düğmesi, arama | canlıda |
| ✅ | Ortak kabuk: sol menü, üst çubuk (arama Ctrl K, nöbet sayacı, + Yeni) — ölçüler prototipten | canlıda |
| ✅ | Yatak paneli: dört kutu, birim başlıkları, kart ölçüleri, boş/temizlikte/rezerve kartlar, hastasız birimler | canlıda |
| ✅ | Alarmlar · Görevlerim · Vardiya devri · Hasta Kabul · Doluluk (Faz 4'ün ilk beşi) | canlıda |
| ⏳ | Faz 4 kalanlar: Yatak başı ölçüm, Eczane, RRT, Yönetici özeti, Kalite, İş yükü, Cihazlar, Denetim, Yönetim, Ayarlar, Hasta sayfası | sırada |
| ✅ | Tur 0: sunucu (API + veritabanı) güncel main'e alındı, yedekli yayın yöntemi | canlıda |
| ⛔ | 10 yoğun bakım dışı birim (Acil, Poliklinik, servisler…): sunucuda birim türü + bina/kat alanı gerekir | Asaf |

## Faz 1 — Ortak kabuk (her ekranı etkiler)

- **Sol menü:** üzerine gelince açılan alt menüler (prototipin `.fly` paneli: Cihazlar, Sterilizasyon, Yönetim alt sekmeleri), aktif öğe vurgusu, sayaç rozetleri (Alarmlar, Devir), hover/çıkış animasyonları.
- **Üst çubuk:** yol gösterici (Hastane › Sayfa › Sekme), ortada arama (Ctrl K), "Rol gözüyle bak" (yalnız sistem yöneticisi), saat, "Nöbet bitimine" sayacı, "+ Yeni" menüsü, bildirim rozeti, kişi menüsü.

## Faz 2 — Ana sayfa (tanıtım sayfası)

- Prototipin `anasayfa/index.html`'i canlıya: üst menü (Nasıl çalışır · Ekranlar · Mobil · Güven), "Klinik izlem" kahraman bölümü, örnek yatak sahnesi + telefon görünümü, rol kartları, alt bölümler.
- Giriş ekranına **"Ana sayfaya dön"**; ana sayfaya **"Kullanıcı girişi"**.
- Karar gereken: ana sayfa `8080/` kökünde mi, uygulama `8080/app` altına mı taşınır? (Önerilen: kök = ana sayfa, `/app` = uygulama.)

## Faz 3 — Yatak paneli kalanlar

- Dört kutu: bekleyen alarm (var), geciken hemşirelik işi (Görevler verisinden), devir imzası bekleyen (Devir verisinden), görülmemiş sonuç (laboratuvar verisi gelince; o zamana dek "veri yok").
- Başlık alt satırı: "N birim · x/y dolu · son veri n sn önce".
- Birim başlığında kat / tür etiketleri; tanı satırı (HIS tanısı varsa).
- Nabız çizgisi görünmüyor: trend okumasının bu kartlar için neden boş döndüğü doğrulanacak.

## Faz 4 — Canlıda olan ekranların görünümü (prototipe eşitleme)

Alarmlar · Hasta sayfası · Hasta Kabul · Doluluk · Yatak başı ölçüm · Görevlerim · Devir · Eczane · Hızlı yanıt (RRT) · Yönetici özeti · Kalite · İş yükü · Cihazlar · Denetim · Yönetim · Ayarlar

## Faz 5 — Tanımlar ve kataloglar (gerçek içerik)

Hizmet kartı / fiyatlar · İlaç listesi · Tanı listesi (ICD) · Diyet listesi · Bakım istem listesi · Bölüm/branş listesi · Otomatik hizmet tanımı · Mesaj kalıpları · Doküman tanımları · Protokol tipleri · Epikriz şablonu · Kayıt seçenekleri · Bildirim kuralları.
Birim / oda / yatak tanımları Yönetim → Yapı'dan yapılır.
**Not:** çoğunun canlıda veritabanı tablosu yok → sunucu tarafı gerekir (Asaf ile paylaşım).

## Faz 6 — Canlıda hiç olmayan modüller (sunucu tarafı gerekir)

Doktor iş listesi · Tüm gelişler · Duvar monitörü · Birim panosu · Randevu · Poliklinik sıra · Cihaz randevu · Yatanlar · Kamera · Ameliyathane · Laboratuvar · Kan bankası · Numune · Sterilizasyon · Nöbet · Enfeksiyon · Vezne · Medikal muhasebe · Hakediş · Dönem onay · İK · Raporlar · İş takip · Pilot.
Her biri için önce ekran (prototipin birebir kopyası), sonra sunucu uçları; Asaf'ın yol haritasıyla sırası birlikte belirlenir.

## Sıra

Faz 1 → Faz 2 → Faz 3 → Faz 4 (ekran ekran) → Faz 5 → Faz 6. Sahip istediği ekranı ekran görüntüsüyle öne alabilir.
