# Mobil · tasarım planı (24.09.2026)

Okuyan: Ozan ve bundan sonraki oturumlar. Kararlar Ozan'ın; bu belge onları tek yerde toplar.

## Verilen kararlar

| Konu | Karar | Nerede |
|---|---|---|
| Sıra | **Önce PWA (prototip), sonra Expo** | bu oturum |
| Roller | 4 rol tam (hemşire, hekim, hızlı yanıt, biyomedikal) + diğerlerine tek sayfa özet; BT "masaüstünde açın" | Taslak 22 öncesi soru |
| Ne zaman | Ekran ≤ 760 px ise kendiliğinden (tarayıcı + ana ekrana eklenmiş PWA) | aynı |
| Alt menü | **C** · 5 sekme, ortada eylem düğmesi | Taslak 22 |
| Üst çubuk | **C** · arama öncelikli (+ küçük sayfa etiketi, zil, kişi) | Taslak 22 |
| Bana | **C** · öncelik kartı + "Sonra" listesi | Taslak 22 |
| Hastalar | **A** · yatak kartları | Taslak 22 |
| Seçili sekme | **B** · dolgu hap + kalın yazı; basınca küçülür | Taslak 22 · 2. tur |
| Orta düğme | **A** · çentikli daire | Taslak 22 · 2. tur |

## Rol başına alt menü

| Rol | 1 | 2 | orta | 4 | 5 |
|---|---|---|---|---|---|
| Hemşire | Bana | Hastalar | **Ölç** (yatak başı) | Bildirim | Ben |
| Hekim | Bana | Hastalar | **Alarm** | Bildirim | Ben |
| Hızlı yanıt görevi olan | **Çağrı** | Hastalar | Alarm / Ölç | Bildirim | Ben |
| Biyomedikal | İşler | Cihazlar | **Arıza** | Bildirim | Ben |
| Eczacı · kabul · kalite · başhekim | Özet | — | — | Bildirim | Ben |
| BT | "Bu rol masaüstünde çalışır" | | | | Ben |

## Onaylanan 8 madde → nasıl işlenir

1. **iPhone'da bildirim sınırı.** iPhone'da web uygulaması yalnız ana ekrana eklenince (iOS 16.4+) ve **HTTPS** üzerinden bildirim alır; arka planda ses çalamaz. → Ben › "Telefona bildirim" kurulum adımları cihazı tanır (iPhone / Android / masaüstü) ve eksik adımı söyler. Kritik alarmın yedek kanalı (SMS / çağrı) **karar bekliyor**, ekranda "yedek kanal: kurulumda belirlenir" diye yazar.
2. **Kaydırarak onay.** Bana'daki kritik kartta "Gördüm" düğme değil kaydırma: yanlış dokunma kayda geçmez.
3. **Ağ koparsa.** Üstte şerit: "Bağlantı yok · son veri 4 dk önce". Yatak başı ölçümü kuyruğa girer ("1 ölçüm gönderilmeyi bekliyor"), bağlantı gelince gider. Prototipte Ben › "Bağlantı kopmasını dene" ile gösterilir.
4. **Bileklik okutma.** Android Chrome'da kamera ile (BarcodeDetector). iPhone'da tarayıcı desteği yok → "listeden seç" yolu; gerçek üründe ek kütüphane.
5. **Titreşim.** Kritik alarmda Android titrer (navigator.vibrate). iPhone web'de titreşim yok, ekranda yazar.
6. **Gece teması.** Tema: Açık · Koyu · **Otomatik (20:00–08:00 koyu)**.
7. **Hızlı yanıt.** Çağrı kartında tek dokunuş: "Yoldayım" → "Yanındayım"; her biri saatle kayda geçer.
8. **İki uygulama.** PWA (web) ve Expo (homunculus-mobile) yan yana; Expo'ya taşıma PWA onayından sonra. Tek kod tabanına dönüş ayrı karar.

## Mimari (prototip)

- `app/mobil.js` + `app/mobil.css`, `shell.js`'ten sonra yüklenir. `H.renderApp`'i sarar: masaüstü kabuğu çizildikten sonra dar ekranda sol şerit gizlenir, üst çubuk telefon üst çubuğuyla değişir, alt menü eklenir.
- Sayfalar yeniden yazılmaz (Görevler, Yatak başı, Alarm, Hasta…); telefona göre sıkıştırılır. Yeni sayfa yalnız: **Bana** (`mhome`), **Bildirimler** (`mnotif`), **Masaüstünde açın** (`mdesk`).
- Test: 390×844 telefon öykünmesi, her rol, açık/koyu, dört dil.

## Expo'ya taşıma (sonraki tur)

- Taşınacak: kabuk (alt menü + orta düğme + arama üst çubuğu), Bana, Hastalar, Hasta, Bildirim, Ben. Verisi motorda var.
- Bekleyecek: Ölç (yatak başı), görevler, roller: motorda karşılığı yok.
- **Dokunulmaz:** `homunculus-mobile/src/transport/` (canlı pilot). SDK 54'te kalır: App Store'daki Expo Go yalnız SDK 54'ü açıyor (Ağustos 2026 itibarıyla).
- Android: Play Store'daki Expo Go daha yeni SDK isteyebilir → SDK 54 için Expo Go'yu expo.dev/go adresinden indir.

## 25.09 · sonraki kararlar (Ozan)
| Konu | Karar |
|---|---|
| Giriş ekranı | A · koyu marka zemini, form alttan kart, **tek ekran** (kaydırma yok) |
| Renk | B · canlı petrol (renk yalnız anlam taşıyan yerde) |
| Üst çubuk | **A kalıcı** · sade başlık (sayfa adı büyük, altında birim · nöbet) |
| Ana sekme | **İşlerim** (eski "Bana"); ad ve tarih yok |
| Profil sekmesi | "Ben" → **Profil** |
| Hızlı dönüş | **Face ID yok**; kişinin kendi PIN'i (yoksa normal giriş) |
| Bildirim kurulum paneli | telefonda yok |
| Kaydırma | hasta ekranında sekmeler arası, ilk sekmede ve ayrıntı sayfalarında geri |
| Öneriler | 1–9, 11, 12 uygulandı; 10 Expo'da |
| Kamera modülü, HBYS ekranları | "şu an tamam" |

