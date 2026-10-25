# Eksikler · Temizlik · Senden beklenenler · 2026-10-25

Veri zinciri (Adım 1–6) bitti. Bu belge: yapmadığımız/eksik süreçler, "burada olmasın / düzeltilecek" temizlikler ve senden (sahip) beklenen kararlar. Yeni iş yaptıkça güncellenir. Kapsam için ayrıca: `FORM-DURUM.md`, `VERI-ZINCIRI-PLAN.md`.

## A. Temizlik / düzeltme ("burada olmasın")
- [x] Ekran altyazılarındaki "(tasarım)" etiketleri kaldırıldı (randevu, vezne, raporlar, iş takip, labislem, İK).
- [x] Kalan "· tasarım" yer tutucu toastları dürüstleştirildi/bağlandı (yeni doğan, onam ekle→dosya, hazırlık açıklaması, sağ-tık menüleri, yazdır çıktıları→gerçek yazdırma).
- [ ] **Hasta Dosyası alt-tab sağ-tık menüleri** (Faturalar: Ödeme/İptal/İade/Faturaya çevir…) hâlâ yönlendirme toastı veriyor. Karar: bunları gerçek yapalım mı, yoksa kaldırıp vezne İşlem Havuzu'na mı bırakalım? (Gerçek aksiyonlar zaten vezne'de.)
- [ ] **Vezne demo seed'leri** (faturalar/gfk/evrak'taki Günel Məmmədova vb.) klinik hasta listesindeki adlarla eşleşmiyor → fatura satırına tıklayınca "kart yüklü değil". Seed adlarını klinik hastalarla hizalayalım ya da demo seed'i azaltıp zincire bırakalım.
- [ ] **Kurumsal Faturalama iki yerde** (Vezne sekmesi + Medikal Muhasebe hub). Ev kararı: ikisi de kalsın (biri kısayol) mı, tek yer mi?
- [ ] Rapor: listeden çıkarılan raporların `reportData()` yardımcıları duruyor (ölü kod, zararsız). İstenirse temizlenir.

## B. Yapmadığımız / eksik süreçler (öncelik sırası önerim)
1. [ ] **Hasta kabulde protokol otomatik açılsın** — şu an protokoller hasta dosyası açılınca örnekten geliyor; kabulde gerçek protokol açılması daha doğru.
2. [ ] **İade / avans → faturaya mahsup** — iade onayı var ama faturaya/tahsilata etkisi zincire bağlı değil.
3. [ ] **Tahsilat derinliği** — parçalı/kısmi ödeme, avans mahsup, para üstü.
4. [ ] **Doktor muayene derinliği** — istem→sonuç girişi, konsültasyon ekranı, ameliyat planlama/notu, e-reçete.
5. [ ] **Randevu takvim görünümü** — gün/hafta çizelgesi (grid), web randevu, slot kapatma.
6. [ ] **İK akışları** — izin / işgöremezlik, nöbet çizelgesi görünümü.
7. [ ] **Çeviri turu** — yeni metinlerin AZ/RU/EN sözlüğü (varsayılan dil Azerice).
8. [ ] **Ön büro ekranları** — Hasta Uyarı, Refakatçi, Sevk, Kara Liste, Müstehaklık (FORM-DURUM eksikleri).
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
