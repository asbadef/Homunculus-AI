# Web uygulaması · ekip giriş bilgileri

01.10.2026 (#314): giriş ekranındaki **"Hızlı giriş"** kutusu artık görünmüyor; ekran canlıya hazır görünsün diye.
Hesaplar aynen çalışır. Bu dosya yalnız ekip içindir.

## Hızlı giriş kutusunu açmak

Adresin sonuna `?hizli=1` ekleyin:

- http://localhost:5199/app/?hizli=1

Sağ altta "Hızlı giriş" yeniden görünür; bir hesaba tıklayınca şifresiz girilir.

## Hesaplar

| Kullanıcı adı | Şifre | Rol |
|---|---|---|
| dr.kamran | Demo123! | Hekim (2FA açık) |
| hs.sevda | Demo123! | Sorumlu hemşire |
| hs.gulnar | Demo123! | Hemşire |
| hs.nuray | Demo123! | Çocuk hemşiresi |
| rrt.emil | Demo123! | Hekim · hızlı yanıt ekibi |
| ecz.lale | Demo123! | Klinik eczacı |
| bio.orxan | Demo123! | Biyomedikal mühendis |
| kabul.ulviyye | Demo123! | Hasta kabul |
| mudur.rauf | Demo123! | Yönetici (başhekim) |
| kalite.tural | Demo123! | Kalite |
| admin | Admin123! | Sistem yöneticisi |
| yeni.hekim | Gecici1! | İlk girişte şifre değiştirme akışı |

- 2FA kodu: `123456`
- Şifremi unuttum kodu: `482913`
- Telefonda hızlı dönüş PIN'i: sabit değil — ilk girişte kullanıcı kendisi belirler (`app/mobil.js`)

Kaynak: `app/core.js` (kullanıcı listesi ve kodlar). Kod değişirse bu dosya da değişir.
