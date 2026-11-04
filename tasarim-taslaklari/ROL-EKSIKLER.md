# Rol Bazlı Eksikler · 04.11.2026

Her rol için **yapıldı** (ana hatlar) ve **eksik/derinleşmesi gereken** süreçler. Öncelik: 🔴 önemli · 🟡 orta · ⚪ ileri faz. "Test" = büyük ihtimalle var ama sahibin testiyle doğrulanmalı.

---

## HEKİM (doktor)
**Yapıldı:** İş listesi + tıklanabilir kuyruklar (imza/epikriz/sonuç), zengin muayene editörü, istem (lab/rad/ilaç/reçete/kan/konsültasyon/diyet/bakım/ameliyat/periyodik), zengin tanı (ön/kesin/ayırıcı + taraf + evre), epikriz.
**Eksik:**
- 🔴 **Konsültasyon cevap akışı**: konsültan hekim cevabını yazar, isteyen hekim görür (şu an istek var, cevap döngüsü zayıf).
- 🔴 **Muayene imza/mühür sonrası kilit + versiyon** (imzalı belge değiştirilemez, düzeltme yeni versiyon) — test/derinleştir.
- 🟡 Order sonucu gelince hekime **otomatik bildirim** (kısmen var, güçlendir).
- 🟡 Reçete **e-imza / e-reçete** (Azerbaycan e-reçete netleşince).
- ⚪ Doktor kişisel istatistik / hakediş görünümü.

## HEMŞİRE
**Yapıldı:** Görev çizelgesi (24s), bedside vital + NEWS2 (yaş-bantlı), formlar (ağrı/braden/aldığı-çıkardığı/kan şekeri/RASS), ilaç uygulama (uygula/pas geç/iade), bakım planı (NANDA), hasta-yatak ataması.
**Eksik:**
- 🔴 **Konsolide gözlem flowsheet**: tek ekranda saatlik tüm gözlemler (vital+form+ilaç bir arada, salt-okunur) — formlar var, birleşik görünüm yok.
- 🟡 **Kan transfüzyon takibi** (çapraz uyum, reaksiyon izlem, ünite takibi).
- 🟡 Vardiya/nöbet çizelgesi ile hemşire ataması entegrasyonu.
- ⚪ Taburcu hemşirelik özeti / hasta eğitimi formu.

## ECZACI
**Yapıldı:** Karşılama/muadil/transfer/red, stok (kritik/miadı), iade/zayi, sarf Lot/Seri/SKT + imha, ilaç bayrakları (gerçek: YR/SZ/PD/MJ/ID + narkotik grup), temel etkileşim.
**Eksik:**
- 🟡 **Kemoterapi eczane** (hazırlama, doz/BSA hesap, protokol) — referansta ayrı modül, bizde yok.
- 🟡 **Birim-doz karşılama** detayı (ilaç hazırlama/paketleme izi).
- ⚪ **Tam DDI/Vademecum motoru** (gerçek etkileşim DB) — bilinçli ertelendi, örnek görsel bekliyorum.
- ⚪ ITS/karekod (Azerbaycan muadili netleşince).

## HASTA KABUL / VEZNE
**Yapıldı:** Kabul (tek ekran), randevu, protokol, fatura (satır-kalem/kurum payı/KDV + iptal/kilit), indirim onay, GFK takip, evrak takip, iade, tam ülke listesi, **avans/depozit alma + taksit planı (aylık eşit bölme, sıradaki taksit tahsili)** ✅.
**Eksik:**
- 🔴 **Vezne/admin-yetki DETAY ekranları referansla kıyaslanmadı** (bu ekran görüntüleri sette yoktu — sahipten görsel bekliyorum).
- 🟡 **POS / online ödeme** entegrasyonu (şu an stub).
- 🟡 Kurum faturası (toplu/dönem) — medmuhasebe'de var, derinlik/kıyas gerek.

## LABORANT (lab + radyoloji)
**Yapıldı:** Numune (tüp kapak renk, red/tekrar, reddeden/tekrara atan), lab sonuç (yaşa göre referans + trend + anormal), radyoloji yapılandırılmış rapor + PACS stub + kritik bulgu, çoklu-şube sonuç.
**Eksik:**
- 🔴 **Lab/radyoloji tekniker süreci** (numune kabul→çalışma→sonuç onay zinciri derinliği) — sahip anlatacak.
- 🟡 **Cihaz (LIS) entegrasyonu** — otomatik sonuç (şu an manuel).
- 🟡 **Patoloji iş akışı** (makroskopi/mikroskopi/rapor) ayrı.
- ⚪ Radyoloji **modality worklist** / çekim listesi · dış lab gönderim takibi.

## MALİ İŞLER / MUHASEBE
**Yapıldı:** Dönem onay, indirim/iade onay zinciri (çok kademeli), medikal muhasebe (kurum faturası, açık alacak).
**Eksik:**
- 🔴 **Hakediş modülü** (doktor/personel performans + ödeme) — yok.
- 🟡 Gelir-gider / kârlılık raporları derinliği.
- 🟡 Kurum mutabakat / tahsilat eşleştirme.

## YÖNETİCİ / KALİTE
**Yapıldı:** Özet, raporlar, doluluk, kalite, enfeksiyon kontrol, iş yükü, pilot ölçüm.
**Eksik:**
- 🟡 **KPI gösterge panosu** derinliği (yatış/doluluk/gelir trendleri).
- 🟡 Kalite göstergeleri otomatik hesap (enfeksiyon/düşme hızı — pilot altyapısı var).
- ⚪ Yönetim raporları özelleştirme / zamanlanmış rapor.

## BİYOMED / STERİLİZASYON / SİSTEM (admin)
**Yapıldı:** Cihaz yönetimi, sterilizasyon (set/yük/araba/parametrik), admin (kullanıcı/rol/yetki/güvenlik/katalog: ICD/ilaç/lab ref/hizmet/doküman/ptip/fiyat/bölüm/cihaz).
**Yapıldı (ek):** Cihaz **bakım/kalibrasyon takvimi + süresi gelen bildirimi** (biyomed bildirim merkezine düşer) ✅.
**Eksik:**
- 🟡 **yetki.xls tam ağacı** (957 madde) içe aktarma + buton-buton eşleme.
- ⚪ **Kurulum sihirbazı** (yeni hastane kurulumu).

---

## ÇAPRAZ / GENEL (tüm roller)
- 🟢 **Rol×ekran yetki taraması** `qa/yetki-audit.py` ile otomatik: NAV sızıntısı yok, her ekran kasıtlı yetkiye dayanıyor ✅. Buton-buton (ekran içi aksiyon) hâlâ sahibin testiyle en isabetli.
- 🔴 **Tek backend / canlı veri akışı (M1)** — en büyük iş; panel + mobil app'ler tek kaynaktan beslenecek.
- 🟡 Bildirim merkezi rol bazlı derinlik · durum renk sistemi tüm ekranlara tam yayılım.
- ⚪ Mobil (panel-telefon ya da native) derinliği · tanıtım/landing sayfası · hakediş · kurulum sihirbazı.

## Önceki parkta bekleyenler
- Klasör taşıma (worktree — dikkatli ele alınacak) · mobil app yaklaşımı (A panel-telefon / B native port) · DDI örnek görseli · lab tekniker anlatımı · vezne/admin detay ekran görüntüleri.
