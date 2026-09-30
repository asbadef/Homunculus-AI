# Oturum günlüğü · 24–25.09.2026 · ana sayfa + mobil (PWA)

Ayrıntılı madde listesi: `istekler.md` #142–191. Kararlar: `mobil-tasarim-plani.md`.

## Ne yapıldı
- **Ana sayfa** (`anasayfa/`, eski `tanitim/` yönlendirir): klasör bağlantıları `index.html`'e; `#24-saat` seçici hatası (sayfayı bembeyaz yapıyordu); görsel dili C = gerçek ekran görüntüsü + odak/bulanık; Başlık 3 (değişen kelime + tek satır sabit cümle); kahramana skor taslağı kartı + uygulamanın "Bana/İşlerim" ekranını gösteren telefon.
- **Çeviri**: koda gömülü Türkçe için `app/ceviri.js` + `ceviri-sozluk.js` (2.053 kalıp, `{#}` sayı, `{*}` joker, AZ sıra eki). Ölçü: RU ekranda Türkçe 1.023 → 26 (kalan: kişi adı, radyoloji raporu, sistemin derlediği cümleler).
- **Mobil (PWA, ≤760 px)** `app/mobil.js`, `mobil.css`, `tarayici.js`: alt menü + çentikli orta düğme, üst çubuk A (sade başlık), İşlerim / Hastalar / Bildirim / Profil; giriş ekranı tek ekran; pencereler tam ekran; form seçici (alt alta liste); monitör telefonda yeniden; ses (iPhone sessiz modda da, hasta değişince kesilmiyor); kaydırarak gezinme (hasta sekmeleri + geri); gerçek kamera ile bileklik/barkod okutma; PIN ile hızlı dönüş (Face ID kaldırıldı); öneriler 1–9, 11, 12.
- **Ölçüm düzeni** (scratchpad, oturuma özel): `mtest.cjs` (CDP telefon öykünmesi, gerçek dokunma), `crawl.cjs` / `crawl-form.cjs` (çeviri taraması), `audit.cjs` (360/393/430 taşma).

## Nerede takıldık / dersler
- Üç tarama aynı anda koşunca yerel sunucu `.js` isteklerini düşürüyor → taramalar sırayla.
- `grep`/regex ile "Türkçe mi" tespiti AZ'de yanıltıyor (ğ, ı AZ'de de var) → TR/EN tarama karşılaştırması doğru yöntem.
- Form kabuğu 2.050 px'e çıkıyordu: taşma taraması kaydırma alanlarının içini saymadığı için kaçırmıştı.
- Bilgisayarın IP'si günlük değişiyor (24.09 .85 → 25.09 .105).
- iPhone ana ekran uygulaması eski dosyayı tutabiliyor → `index.html`'de `?v=` sürüm etiketi; değişiklikten sonra uygulamayı tamamen kapatıp açmak gerekir.

## Bekleyen
- ⏸ **https** (Face ID gerekmez dendi; kamera, mikrofon, telefona bildirim hâlâ https ister) — Ozan kararı.
- ⏸ Marka kimliği (Ozan: "biraz bekleyecek").
- **Sıradaki iş**: #141 etiketler + geniş form penceresi (masaüstü) → #109/110 hemşirelik tanı kataloğu → #96 yasal sayfalar → #24/32 Taslak 15 fikirleri → #100 Tasarım Masası rozetleri.
- **Expo'ya taşıma**: telefon görünümü Ozan'ın onayından sonra (SDK 54'te kalır; `src/transport` dokunulmaz). Öneri 10 (kilit ekranında canlı durum) orada.
