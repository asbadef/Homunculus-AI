# QA / Test İş Planı — tüm modüller, tüm roller · 25.10.2026

Amaç: Her rolün gördüğü her ekranı ve her butonu tek tek test etmek; hataları, yanlışları, tasarım/renk/hizalama sorunlarını ve çeviri eksiklerini bulup düzeltmek. Araç: **Playwright** (tarayıcıyı otomatik süren program; `tasarim-taslaklari/qa/` altında betikler).

## Roller (10)
Klinik: hekim, hemşire · Destek: eczacı, biyomedikal, hasta kabul, **MSÜ (sterilizasyon)**, **laborant** · Yönetim: başhekim/yönetici, kalite, sistem (BT).
> Yeni eklenenler: **msu** (`msu.aygun`) → Sterilizasyon ana ekranı; **laborant** (`lab.elnur`) → Laboratuvar. İkisi de hızlı girişte.

## Fazlar

### Faz 1 — Açılış/çökme taraması ✅ (bitti)
Her rol × her ekran (10 × 36 = 360 kombinasyon) otomatik gezildi; JS hatası / boş ekran arandı. **Sonuç: 0 hata.** Betik: `qa/smoke.py`.

### Faz 2 — Buton / etkileşim testi (sürüyor)
Her modülde: sekmeler, butonlar, sağ-tık menüleri, formlar tek tek açılır; her adımda JS hatası yakalanır. Öncelik: steril, vezne, İK, randevu, admin, hasta360, medikal muhasebe, raporlar, iş takip, lab. Betik: `qa/interact.py`.
- Çıktı: hatalı buton/handler listesi → düzelt.

### Faz 3 — Görsel / tasarım incelemesi
Her ana ekranın ekran görüntüsü alınır; kontrol: taşma (overflow), hizalama, renk tutarlılığı (durum renkleri, rozetler), okunurluk, boş/çirkin alanlar, mobil/dar genişlik. Sorunlar → düzelt.

### Faz 4 — Çeviri tamlığı (varsayılan AZ)
Her ekranda Türkçe kalmış metin taranır; AZ/RU/EN sözlüğe eklenir.

### Faz 5 — Düzeltme turu + yeniden test
Bulunan her şey düzeltilir; Faz 1-2 betikleri tekrar koşulur (regresyon). Temiz olana kadar.

## Nasıl çalıştırılır
Dev sunucu açıkken (`localhost:5180`):
`python qa/smoke.py` (çökme taraması) · `python qa/nav.py` (rol menüleri) · `python qa/interact.py` (buton testi).

## Durum
- [x] Faz 1 — açılış taraması: 10 rol × 36 ekran = 360 kombinasyon, **0 hata**.
- [x] Faz 2 — buton/etkileşim: steril(8 sekme)+vezne(8)+İK+randevu(3)+medmuhasebe+raporlar+hasta360+lab(3)+istakip+admin(5)+patient butonları/satırları tek tek tıklandı, **0 hata**.
- [x] Faz 3 — görsel: sterilizasyon 8 sekme + şablon/detay modalleri incelendi; tasarım/renk/hizalama **temiz** (parça formu düzeltmesi doğrulandı).
- [~] Faz 4 — çeviri: `qa/i18n.py` ile çevrilmemiş UI etiketleri otomatik çıkarıldı (350 aday). Gerçek Türkçe etiketler toplu çevrildi → **350 → 189** (161 etiket AZ/RU/EN sözlüğe eklendi). Vezne/hasta360/admin/raporlar/İK artık büyük ölçüde Azerice. **Kalan 189:** çoğunlukla zaten-AZ veri (bölüm/kişi adları), sayı içeren dinamik metinler (alt başlıklar, "N aktif set"), kod/yetki anahtarları (pt_*, steril) ve az sayıda uzun admin yetki açıklaması. Dinamik/birleşik metinler sözlükle çevrilemez (kod değişikliği gerekir).
- [x] Faz 5 — diğer modüller görsel incelendi (vezne/randevu/İK ekran görüntüleri): tasarım/renk temiz. Regresyon: smoke tekrar **0 hata**.
