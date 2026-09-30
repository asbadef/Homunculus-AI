---
tip: cikti
tags: [konsey, tasarim, homunculus]
ozet: Homunculus tasarım süreci baştan sona — önce doğruluk temeli, sonra hasta paneli (ayrı trend grafikleri + görünür SOFA onayı), devir kuyruğu, pilot, mobil AZ; marka Tek Çizgi çekirdek + Buta Azerbaycan katmanı.
guncelleme: 2026-09-23
---

# Konsey: Homunculus tasarım sürecini baştan sona nasıl planlamalıyız?

**23.09.2026** · Analist (opus) · Uygulayıcı (sonnet) · Eleştirmen (opus)

> Not: Konsey becerisi MedRapor wiki'sine göre yazılmış. Homunculus'un kendi Türkçe wiki'si
> bu makinede henüz kurulmadığı ve projeler birbirinin dosyasına dokunmadığı için rapor
> `C:\Dev\Homunculus\tasarim-taslaklari\` altına yazıldı. Ajanlar Homunculus reposunu ve
> 06/08/09 taslaklarını okudu.

## Karar

**Tasarım yeni ekran icat etmekle değil, doğrulukla başlamalı.** Kod, taslakların sandığından
daha ileride; ama en değerli parçalar demoda görünmüyor ya da yanıltıcı çiziliyor. Plan:

0. **Doğruluk temeli (önce).** Taslaklardaki durum etiketleri koddan doğrulanır (08'de üç hata
   bulundu ve düzeltildi: eskalasyon süreleri, SOFA onayı, devir). Süs dalga çizgisi ya
   "temsili" diye etiketlenir ya da gerçek dalga gelene kadar kaldırılır. Sloganlar yalnız
   ürünün bugün kanıtlayabildiğini söyler. **Kapsam kararı** (yalnız yoğun bakım mı, servisler
   de mi) Ozan tarafından açıkça verilir ve yazılır — `docs/vision.md` "yalnız YBÜ" diyor,
   Ozan "servisler de" diyor.
1. **Hasta paneli — satış demosunun kalbi.** Monitör en üstte. Kalp hızı ve her vital **ayrı
   küçük grafikte**, sabit klinik ölçek, birim, eşik bandı ve hastanın kendi normal aralığı
   şeridi (`rules/patient_relative.py` var), veri kaynağı rozeti (cihaz / elle / eksik).
   Var olan SOFA onay ekranı (`severityScore.jsx`) demoda görünür kılınır ve 06'daki kartla
   aynı dile getirilir; "anlık SOFA" ile "24 saatin en kötüsü" ayrı etiketlenir.
2. **İki imzalı devir.** Motor iki imzalı (`admission/router.py:316-360`), ekran tek imzalı ve
   yalnız tarayıcıda. Eksik parça: **"imzamı bekleyen devirler" kuyruğu.**
3. **Pilot: sessiz mod + başlangıç ölçümü + pilot raporu.** Satışı kapatan belge; başlangıç
   ölçümü pilottan *önce* alınmazsa sonradan "iyileştirdik" denemez.
4. **Mobil Azerbaycanca.** Mobil yalnız Türkçe (`homunculus-mobile/src/i18n/tr.ts`). İlk pazar
   için web'deki her eksikten büyük.
5. **Kapsam genişlemesi** (Faz 0'da onaylanırsa): servis hızlı vital girişi; yenidoğan için
   uygun skorun klinik ekiple belirlenmesi (motorda yenidoğana özgü kural yok; NEWS2 ve SOFA
   erişkin araçları).
6. **Kurulum sihirbazı + ilk kullanım turu.**
7. **Marka:** çekirdek logo ve uygulama simgesi **Tek Çizgi**; Azerbaycan broşür, duvar ve
   kampanya katmanı **Buta**. Slogan: yalnız kanıtlanabilir olanlar. Yazı tipi çelişkisi
   çözülür (Space Grotesk kararı vs. karakterlerin kendi fontları; `ə` desteği test edilir).

Diğer roller (RRT, eczacı, biyomedikal) için ayrı tasarım turu yok; Faz 1–3'ün çıktıları
onların sayfalarına yansıtılır.

## Nerede ayrıştılar

- **Marka.** Uygulayıcı *yalnız Buta* dedi (ilk pazar yerel güven ister). Analist ve Eleştirmen
  *Tek Çizgi çekirdek* dedi: Buta markayı tek pazara kilitler, ulusal simgenin ticari
  kullanımı doğrulanmalı, halı dokusu klinik ekranda gürültü. Ayrım "marka tek pazar için mi,
  büyüme için mi" varsayımından geliyor. **Başkan:** ikisini katmanlara ayır — kimlik Tek
  Çizgi, Azerbaycan yüzü Buta.
- **Servis önceliği.** Uygulayıcı servis vital girişini 3. sıraya koydu; Analist en sona ve
  koşullu; Eleştirmen kapsam çelişkisini ilk sıraya aldı. **Başkan:** kapsam kararı Faz 0'da,
  uygulaması Faz 5'te.
- **Klinik güvenlik.** Yalnız Eleştirmen sahte dalga, iki SOFA, "Sepsis şüphesi" dili ve slogan
  abartısını gördü; diğer iki ajan bunları değerlendirmede doğruladı.

## Sıralama

| Cevap | Ajan | Sıralar | Ortalama |
|---|---|---|---|
| C | Analist | 2, 1, 1 | **1.33** |
| A | Eleştirmen | 1, 2, 2 | 1.67 |
| B | Uygulayıcı | 3, 3, 3 | 3.00 |

**Çürütülen iddialar (sentezde kullanılmadı):**
- "SOFA onay akışı yok" (Uygulayıcı) ve "eksik olan arayüz bağlantısı" (Eleştirmen) — yanlış.
  `severityScore.jsx` var, `ClinicalDemo.jsx:3374-3384`'te bağlı; yalnız demoda boş.
- "Devir motora bağlı mı doğrulanmalı" (Uygulayıcı) — bağlı değil; `HandoverModal` tarayıcıya
  yazıyor (`clinicalDemo.js:1212`).
- Süre tahminleri (1–1.5 hafta vb.) ve "diğer roller olgun" — dayanaksız.

**Başkanın kendi doğrulaması:** `escalation/service.py:33-35` = 3 dk sorumlu hemşire, 5 dk
hekim, 10 dk RRT (08 taslağı yanlış yazıyordu, düzeltildi). `backendApi.js:228-233` iki SOFA'nın
farklı olduğunu açıkça söylüyor.

## Ham cevaplar (özet)

### Analist (opus)
Sorun eksik özellik değil görünmeyen iş. MultiTrendChart (`ClinicalDemo.jsx:2760-2835`) seri
başına min-max ölçekliyor, eksen yok → 80→88 ile 80→150 aynı eğim. SOFA onayı var ama demoda
boş. Devir iki imzalı motorda, tek imzalı ekranda; kuyruk eksik. Mobil yalnız TR. Vision "yalnız
YBÜ"; yenidoğan kuralı yok. Öncelik: hasta paneli → alarm → devir kuyruğu → sessiz mod/pilot →
mobil AZ → sihirbaz → servis. Marka: Tek Çizgi çekirdek + Buta AZ katmanı; font çelişkisi.

### Uygulayıcı (sonnet)
HandoverModal var ve kritik alarmda engelliyor. Trend üst üste. Faz 1 hasta paneli, Faz 2 devir
bağlantısı, Faz 3 servis vital girişi, Faz 4 satış seti + sihirbaz + sessiz mod. Diğer roller
için ayrı tur yok. Marka: Buta.

### Eleştirmen (opus)
Taslaklar koddan ve kapsamdan uzaklaşıyor. Eskalasyon süreleri yanlış; iki SOFA; NICU'da SOFA
yanlış araç (klinik çıkarım); trend min-max ve sentetik; sahte dalga VF'de düzenli EKG
gösterebilir; "Sepsis şüphesi" başlığı ve kanıtsız sloganlar; yeni uyaran katmanlarının bastırma
kuralı yok; marka adaylarının her birinin zayıflığı. Önce doğruluk temeli.

## İlgili

- `tasarim-taslaklari/06-paneller.html`, `08-surec-haritasi.html`, `09-marka-yeni.html`
- `docs/vision.md`, `docs/gelecek-yol-haritasi-20-madde.md`, `docs/INFINITY-PARAMETER-RECORDS.md`
