# Hasta Mobil Uygulaması (Expo) — M0 Maket

HBYS'nin hastaya bakan yüzü: "hastane cebimde". Bu klasör, telefonda çalışan,
**nümunə (sahte) verili** bir Expo (React Native) maketidir. Homunculus doktor/hemşire
panelinin tasarım diliyle (turkuaz #0891b2, Figtree), varsayılan **aydınlık** tema.

- **Tasarım belgesi:** `../../docs/superpowers/specs/2026-11-04-hasta-mobil-uygulamasi-design.md`
- **Uygulama planı:** `../../docs/superpowers/plans/2026-11-04-hasta-mobil-maket-m0.md`

## Ne var (M0)
- Giriş akışı: onboarding → KVKK rıza → giriş (ülke + FİN/pasaport + doğum tarihi + telefon) → SMS (nümunə) → PIN.
- 5 sekme: Ev · Randevu · Nəticələr · Sağlıq · Profil.
- Zengin ana ekran: hikâye daireleri, afiş karuseli, kısayollar, hızlı servisler, güzel haberler.
- 4 adımlı randevu sihirbazı (hastane→bölüm→doktor+özgeçmiş→tarih/saat→özet).
- Sonuçlar: filtre + detay (referans aralığı, normal/anormal, trend grafiği, **tanı koymayan** "sade açıklama").
- Reçeteler + ilaç detayı + hatırlatıcı. Faturalar, sağlık kartı, yakın takibi (YBÜ/yeni doğan, maskeli),
  aşı kartı, check-up, belgeler, yakın hastaneler, bildirimler.
- Çok dil: AZ (vars.), TR, RU, EN. Gün/gecə teması. Hassas ekranlarda ekran kaydı engelleme.

## Çalıştırma
- Bilgisayar Expo hesabına girişli olmalı. `npm run start` (veya `npx expo start`) → telefonda Expo Go.
- Tarayıcıda hızlı bakış için `npm run web` (web bağımlılıkları eklenirse).
- Testler: `npm test`. Tip kontrolü: `npx tsc --noEmit`.

## Önemli kurallar
- **Nümunə veri dışında hasta verisi tutulmaz.** Tüm veri `src/demo/`.
- Ekran/sekme adları Azerice ve bize özgü — hiçbir referans uygulamadan kopyalanmaz.
- Sistem **tanı koymaz**; sonuç açıklaması "doktoruna danış" der.
- Ana ekran/menü tek listeden beslenir (`src/config/features.ts`) — özellik ekle/çıkar = tek satır.

## Sonraki (M1+)
Gerçek veriye bağlanma (HBYS arka ucu: doktor dizini, sonuç, randevu, reçete, fatura),
hasta FİN/SMS arka uç kimlik akışı, video görüşme, "Sağlığım" (elle giriş). Arka uç modülleri
hazır oldukça ayrı planlanır.

Son güncelleme: 2026-11-04
