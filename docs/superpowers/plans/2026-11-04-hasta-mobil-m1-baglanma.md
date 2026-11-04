# Hasta Mobil — M1: Gerçek Veriye Bağlanma (Köprü Planı)

**Durum:** İleri dönük taslak. **Uygulama, HBYS arka uç modülleri hazır olunca başlar.**
İsimler/uçlar o zaman kesinleşir; bu belge sırayı ve sözleşmeyi şimdiden sabitler.
**Önkoşul:** Faz 0 omurga (giriş/yetki) + Doktor modülü + Lab/Randevu/Fatura modülleri.
**Spec:** `../specs/2026-11-04-hasta-mobil-uygulamasi-design.md` (§5 veri bağlantısı, Ek A).
**M0 maket:** `../../mobile/patient` (tüm ekranlar `src/demo/transport.ts` üzerinden çalışır).

## Temel fikir (neden hızlı olacak)
M0'da her ekran veriyi **tek bir katmandan** (`transport`) çeker. M1 = bu katmanın arkasını
sahte veriden **gerçek API'ye** çevirmek. Ekranlara neredeyse hiç dokunulmaz; iş, `transport`'un
içini doldurmak + hasta girişini gerçek yapmak.

## Sahibin sorusunun cevabı (kayıt → mobil görünürlük)
Bir hasta HBYS'de (FİN'iyle) kayıtlıysa: mobilden FİN + SMS ile girer → arka uç onu `Patient`
kaydıyla eşler → **yalnızca kendi** randevu/sonuç/reçetesini görür. Bir doktor HBYS'de (admin
tarafından) kayıtlıysa → mobil randevu sihirbazının doktor adımında çıkar. Yani görünürlük,
HBYS'deki kayıt + yetki + hastane sınırına bağlıdır.

## Sıra (task'lar — arka uç hazır oldukça)

### M1.1 — Hasta kimliği ve girişi (arka uç + mobil)
- **Arka uç (yeni):** Hasta giriş yolu, personel JWT'den **ayrı**. `POST /patient/auth/start`
  (ülke + FİN/pasaport + doğum tarihi + telefon → SMS gönder), `POST /patient/auth/verify`
  (kod → hasta oturum token'ı). Hasta ↔ `Patient` eşleşmesi; `tenant` sınırı; `security_audit`.
  SMS sağlayıcı (Azerbaycan) seçilir. Hasta, personel `UserRole` sistemine girmez.
- **Mobil:** `src/session/SessionProvider` içindeki mock SMS/PIN gerçek uçlara bağlanır;
  token `expo-secure-store`'da; isteklerde `Authorization`. `validateIdentity` aynen kalır.
- **Biter:** Gerçek bir hasta FİN+SMS ile girip oturum açabiliyorsa.

### M1.2 — Doktor dizini (randevu sihirbazının kaynağı)
- **Arka uç (yeni):** `GET /patient/directory/hospitals`, `.../departments`, `.../doctors`
  (özgeçmiş + foto + boş slotlar). Admin/doktor modülündeki doktor kayıtlarından beslenir.
- **Mobil:** `transport.getHospitals/getDepartments/getDoctors` gerçek uçlara çevrilir.
  `src/demo/types.ts` şekli korunur (uç aynı şekli döndürür).
- **Biter:** Admin bir doktoru HBYS'de açınca mobil randevu adımında görünüyorsa.

### M1.3 — Randevu oluşturma
- **Arka uç:** `GET /patient/appointments`, `POST /patient/appointments` (hasta oturumuyla).
- **Mobil:** `transport.getAppointments` + özet ekranındaki "Onayla" gerçek `POST`'a bağlanır.
- **Biter:** Mobilden alınan randevu HBYS'de görünüyor ve tersi.

### M1.4 — Sonuçlar + reçete + fatura (okuma)
- **Arka uç:** `GET /patient/results`, `.../prescriptions`, `.../invoices` — hepsi hasta
  oturumuna + hastane sınırına bağlı; lab "onayla" sonrası görünür.
- **Mobil:** İlgili `transport.*` uçlara çevrilir; trend/izah/ilaç detayı aynı kalır.
- **Biter:** Onaylanmış bir sonuç hastanın app'inde görünüyorsa.

### M1.5 — Aile hesapları + bildirim (push)
- **Arka uç:** `POST /patient/family` (yakın FİN+doğum tarihi ile bağ, rıza kaydı);
  push için cihaz token kaydı.
- **Mobil:** Profil → aile ekleme gerçek uca; `expo-notifications` ile randevu/sonuç bildirimi.
- **Biter:** Anne çocuğunun sonucunu görebiliyor; "sonucun hazır" bildirimi düşüyorsa.

## Değişmez kurallar (M0 ile aynı)
- Hasta yalnızca kendi + rızalı yakınlarının verisini görür; hastane sınırı delinmez.
- Sistem tanı koymaz; sonuç izahı "doktoruna danış" der.
- Gerçek görseller bağlanır (görsel üretim aracı), yer tutucular kalkar.
- "Sağlığım" ve video görüşme bu fazdan sonra; Sağlığım verisi elle giriş.

## Geliştiriciye bırakılan (arka uç gelince netleşir)
- SMS sağlayıcı seçimi ve hasta oturum token formatı.
- Uç adlarının kesin sözleşmesi (yukarıdakiler öneri).
- Mock→gerçek geçişin bir ortam bayrağıyla ekran-ekran yapılması (M0 demo modu korunur).
