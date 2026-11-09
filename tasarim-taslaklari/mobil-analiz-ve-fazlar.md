# Mobil · eksik/fazla analizi ve kalan fazlar (28.09.2026 gece)

Okuyan: Ozan. Kural (#210, #219, #220): **telefon okur, web yazar.** Telefonda yalnız 5 hızlı işlem var: Gördüm · iş Yapıldı · Eskale · SOFA Onayla · Hekime ulaş.

## 1 · Eklenmesi önerilenler (hepsi salt okunur ya da tek dokunuş)

| # | Öneri | Neden | Backend yükü |
|---|---|---|---|
| E1 | **Son işlemler** özeti (hasta sayfası): "21:30 Sevda Q. alarmı gördü · 21:20 SOFA sistem doldurdu · 20:14 not mühürlendi" | "Rapor gibi yapılan işlemi görsün" (#219) | Yok — denetim kaydını okur |
| E2 | **Hasta başlığında iletişim**: sorumlu hekim ve hemşire adının yanında ara/WhatsApp | "Hasta kartında iletişim bilgisi yok" | Yok — telefon numarası kullanıcı kaydında |
| E3 | **İlaç sekmesinde uygulandı/bekliyor** durumu (yalnız görüntü) | Hekim telefondan "verildi mi" diye bakar | HBYS/eczane okuma (web için de gerekli) |
| E4 | **Skorlar'da NEWS2 dökümü** (şu an yalnız SOFA) | Hemşirenin en çok baktığı skor | Yok — motor hesaplıyor |
| E5 | **Teslim notu salt okunur** (karşı imza web'de) | "Devir imzası bekliyor" bildirimi gelince ne bekliyor görsün | Yok |

## 2 · Çıkarılması / gizlenmesi önerilenler

| # | Alan | Neden |
|---|---|---|
| Ç1 | Profil › **Sunucu** bölümü | Kullanıcının işi değil; canlıda kurulumu BT yapar. Test bitince "Gelişmiş" altına ya da tamamen kalkar |
| Ç2 | Profil › **Kayıttan oynatma** kartı (hız, eşik) | Yalnız test aracı; canlıda anlamsız |
| Ç3 | Profil › **Bağlantı kopmasını dene** | Test aracı; canlıda şerit gerçek kopmada kendiliğinden çıkar |
| Ç4 | İşlerim › **"N yatak stabil"** satırı | Bilgi değeri düşük, Hastalar sekmesinde zaten var |
| Ç5 | Trendler açıkken üstteki **monitör paneli** | Aynı değerler iki kez görünüyor; Trendler'de paneli katlamak ekranı açar |

## 3 · Soruların cevabı

**Başka uygulamadayken kritik alarm tam ekran gelir mi?**
- **Hayır, iPhone buna izin vermiyor.** Uygulama kapalıyken ya da başka uygulamadayken bildirim üstten şerit ve kilit ekranında gelir (Profil'deki denemede gördüğün gibi).
- Tam ekran kırmızı alarm yalnız uygulama açıkken çıkar.
- **iPhone'da daha güçlüsü:** Apple'ın "Kritik Uyarı" izni sessiz modu ve Rahatsız Etme'yi delip sesle çalar. Apple bunu başvuruyla, sağlık uygulamalarına verir. Kendi derlememizi (Expo Go değil) ve Apple onayını ister.
- **Android'de** gelen arama gibi tam ekran açılabilir; o da kendi derlememizle olur.

**Bildirim durdurma aktif mi?**
- Uygulamada "bildirimleri kapat" düğmesi **yok, bilerek** (karar #42: sessiz saat yok, kritik bildirim susturulamaz).
- Kullanıcı telefonun kendi ayarından kapatabilir; bunu engelleyemeyiz. Profil'e artık **"Telefon bildirimleri: AÇIK/KAPALI"** satırı geldi.
- Canlıda öneri: kapalıysa her girişte uyarı göstermek, bir de yöneticiye "şu kullanıcının bildirimleri kapalı" demek.

**Mobilde "Yapıldı" dedim, web'de işaretli değil (#228):** Beklenen durum. Şu an iki ayrı örnek veri var: web prototipi tarayıcıda, telefon kendi içinde. Veritabanı aşamasında ikisi aynı kaydı okuyup yazacak; biri işaretleyince diğerinde de görünecek. Faz B'nin ilk kabul testi bu olacak.

## 4 · Kalan fazlar

| Faz | İçerik | Durum |
|---|---|---|
| **A · Tasarım** (şimdi) | ✅ 28.09 gece: E1 Son işlemler · E2 hasta başlığında hekim/hemşire · E3 doz durumu · E5 devir notu · Ç1–Ç4 · Ç5 geri alındı (küçük monitör her sekmede) · çeviri: EN'de Türkçe kalan %2,8, kalanı ad/kayıt verisi · **E4 NEWS2 dökümü → Faz B** (Ozan: öneri b). Kalan: tanıtımda "Neler var / Kim ne görür" · web sadeleşme (#195) · logo/kimlik (#80) · isim (#201, beklemede) | 🔧 |
| **B · Veritabanı + motor** | Motor bu bilgisayarda (Python ortamı hazır) · PWA kayıtları motora · telefon ve web aynı kayıt (**#228 senkron**) · gerçek giriş ve kişi bilgisi · Gördüm/Eskale/SOFA onayı gerçek uç noktalar · her görüntüleme denetim kaydına · telefon numarası kullanıcı kaydına | ⏳ #213: tasarımdan sonra |
| **C · Bildirim altyapısı** | Kendi derleme (Expo Go yerine) · sunucudan telefona gerçek bildirim · iPhone "Kritik Uyarı" başvurusu · Android tam ekran alarm · HTTPS (#186) | ⏳ |
| **D · Hastane entegrasyonu** | HBYS'den sonuç, ilaç, belge okuma · radyoloji raporu (görüntü yok) · kamera web'de (#9: hukuk/politika ön koşulu) | ⏳ |
| **E · Canlıya geçiş** | Birlikte son test (#203) · örnek verinin silinmesi · git push (#202: ayrı dal; main kararı ayrıca) · pilot birim | ⏳ |
