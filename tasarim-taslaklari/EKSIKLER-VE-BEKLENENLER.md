# Eksikler · Temizlik · Senden beklenenler · 2026-10-25

Veri zinciri (Adım 1–6) bitti. Bu belge: yapmadığımız/eksik süreçler, "burada olmasın / düzeltilecek" temizlikler ve senden (sahip) beklenen kararlar. Yeni iş yaptıkça güncellenir. Kapsam için ayrıca: `FORM-DURUM.md`, `VERI-ZINCIRI-PLAN.md`.

## A. Temizlik / düzeltme ("burada olmasın")
- [x] Ekran altyazılarındaki "(tasarım)" etiketleri kaldırıldı (randevu, vezne, raporlar, iş takip, labislem, İK).
- [x] Kalan "· tasarım" yer tutucu toastları dürüstleştirildi/bağlandı (yeni doğan, onam ekle→dosya, hazırlık açıklaması, sağ-tık menüleri, yazdır çıktıları→gerçek yazdırma).
- [x] **Hasta Dosyası sağ-tık gerçek (tüm para sekmeleri):** Faturalar (Ödeme/İptal/İade/Yazdır) + Ödeme/İndirim/Not/Online/POS (İptal/Sil/İade/Dekont) — o satıra etki eder, kalıcı.
- [x] **Vezne demo seed'leri klinik hastalarla hizalandı** (Elvin Hüseynov, Nərgiz Əliyeva vb.) → fatura/GFK satırına tıklayınca kart açılır. Kalıcılık v2.
- [x] **Kurumsal Faturalama iki yerde** — KARAR (ben verdim): asıl ev **Medikal Muhasebe** (mutabakat/alacak işi), Vezne'deki sekme **kısayol/çalışma yüzeyi**. Tek kod, iki yerden açılır (kopya yok); vezne ekranına "aynı kayıt Medikal Muhasebe'den de açılır" notu eklendi.
- [ ] Rapor: listeden çıkarılan raporların `reportData()` yardımcıları duruyor (ölü kod, zararsız). İstenirse temizlenir.

## Y. Yeni modül: Sterilizasyon (MSÜ / CSSD) — 25.10.2026
Sterisys.com.tr incelenerek benzeri, demo veriyle uçtan uca çalışan bir modül kuruldu (`app/steril.js`). Sol menüde "Sterilizasyon (MSÜ)", yetki `steril` (klinik + yönetim rollerine açık), kalıcı, varsayılan AZ.
- **Akış panosu:** 6 sütun (Kirli Kabul → Yıkama → Paketleme → Sterilizasyon → Steril Depo → Teslim). Set kartları aşama aşama ilerler; her adımda kim+ne zaman kaydı.
- **Paketleme:** parça checklist — eksikse set "Eksik", ilerleyemez.
- **Sterilizasyon:** otoklav + döngü no/sıcaklık/süre + Bowie-Dick/biyolojik test; test keçmədi ise serbest bırakılmaz.
- **Steril depo:** raf + son kullanım + FIFO/30 gün uyarısı.
- **Teslim:** vaka/ameliyat (mevcut ameliyat istemlerinden seçilir ya da serbest) + teslim alan; sonra yeniden kullanıma döner.
- **Set tanımları:** şablon (ad/bölüm/versiyon/parça listesi) — paketleme checklist'inin kaynağı.
- **Komuta merkezi:** aşama sayıları, bugünkü döngü, sorunlu setler, uyarı listesi.
- Donanım (barkod okuyucu/otoklav/HBYS) = ayrı ekip; burada tıkla/kod-gir ile canlandırılır.
- [ ] İleride: set ömrü/kullanım sayısı, kayıp set ("Lost") statüsü, yazdırma belgeleri (etiket/izlenebilirlik raporu).

## A2. Tarama turu bulguları (25.10.2026)
- [x] **Liste filtresi eksikti** — Gelişler, Raporlar, İş Takip, Laboratuvar/Radyoloji, Medikal Muhasebe ve İK ekranlarında arama/filtre kutusu yoktu (sahibin "çoğu ekranda filtreleme yok" şikâyeti). Ortak `H.filterBox`/`H.wireFilter` eklendi; kutuya yazınca tablo satırları (raporlarda kartlar) anında süzülür. Vezne'de zaten vardı.
- [x] İstem modülü tarandı: tüm istem düğmelerinin (lab/rad/hizmet/kons/diyet/bakım/ilaç/reçete/kan/ameliyat) gerçek karşılığı var; "yakında eklenecek" metni ulaşılamayan ölü daldı (zararsız, bırakıldı).
- [x] **Ölü buton/satır taraması** — tüm etkileşimli dosyalar bir betikle tarandı (tanımlı `data-*` kontrolleri ↔ dinleyiciler). Ölü/işlevsiz buton veya "tıklanınca bir şey olmayan" satır **bulunmadı**; şüpheliler (alarm Eskale, footer yasal linkler) aslında başka dosyadaki global dinleyicilere bağlı.

## B. Yapmadığımız / eksik süreçler (öncelik sırası önerim)
1. [x] **Hasta kabulde protokol otomatik açılır** — ayaktan/yatış/vezne/hasta360 kabulünde gerçek protokol oluşur (istemler ona bağlanır).
2. [x] **İade → faturaya mahsup** — Fatura İade onaylanınca ilgili fatura tutarı düşülür, biterse "İade edildi". (Avans iade mahsup kalan iş.)
3. [x] **Kısmi tahsilat** — tahsilat modalında tutar düzenlenebilir; kalan kadar ödenince "Ödendi", yoksa "Bekliyor" (kalan takip). Avans mahsup kalan iş.
4. [~] **Doktor muayene derinliği** — [x] istem→sonuç girişi (lab/radyoloji sonuç → Tedavi'de görünür); kons/ameliyat/e-reçete kalan.
5. [x] **Randevu takvim görünümü** — gün ızgarası (saat×doktor) + **hafta görünümü** (doktor × 7 gün) + **slot kapatma** (boşa sağ tık = kapat, kapalıya tık = aç; kalıcı). Durum renkli, boş hücreden randevu, detay/sil.
6. [x] **İK akışları** — [x] **nöbet çizelgesi görünümü** (tüm personelin nöbet/mesai/izinleri tek listede, tarihe göre, Excel/Yazdır); [x] **izin / işgöremezlik onay akışı** (talep → yetkili onay/red → onaylıysa personel kartı izin tablosuna + nöbet çizelgesine düşer; kalıcı).
7. [ ] **Çeviri turu** — yeni metinlerin AZ/RU/EN sözlüğü (varsayılan dil Azerice).
8. [~] **Ön büro ekranları** — [x] Hasta Uyarı (kalıcı, kartta kırmızı banner) + Diğer menü bilgileri kaydediliyor; Refakatçi/Sevk/Kara Liste/Müstehaklık kalan.
9. [ ] **Mobil / PWA** ve **grafik panolar** — ileri faz.

## C. Senden (sahip) beklenenler
- **Kararlar:**
  - Hasta Dosyası sağ-tık menüleri: gerçek yap mı, kaldır mı? (A maddesi)
  - Vezne demo seed'leri: klinik hastalarla hizala mı, azalt mı?
  - Kurumsal Faturalama evi: vezne mi, medikal muhasebe mi, ikisi de mi?
  - Hasta kabulde otomatik protokol açılsın mı?
  - Hangi placeholder gerçek olsun / hangi süreç "ayrı ekip" kalsın?
- **İçerik / görsel:**
  - Söz verdiğin **vezne kurgusu ekran görüntüleri** (faturalama/provizyon/kurum akışı).
  - `FORM-DURUM.md` kapsam onayı: neyi yapmayalım (kesin "ayrı ekip" listesi).
- **Test geri bildirimi:** test ettiğin modüllerde gördüğün hata/eksikler.

## Nasıl ilerliyoruz
Sen kararları/görselleri verdikçe B listesinden öncelik sırasıyla yapıyoruz. Önerim: düşük riskli **çeviri turu** (7) ile devam edip, sen vezne görsellerini gönderince vezne derinliğine (1–3) geçmek.
