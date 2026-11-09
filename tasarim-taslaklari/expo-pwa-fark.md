# Expo ↔ PWA fark tablosu (28.09.2026)

> ⚠️ 29.09: "Karar" bölümü geçerli. Alttaki tablolar 28.09 öğleden sonraki hâli gösterir; kod o günden sonra ilerledi
> (Skorlar, PIN, kritik alarm var; "Web panelinde" kartı kalktı). Güncel davranış: `TELEFONDA-DENE.md` en üst bölüm.

## ⭐ Karar · 28.09 öğleden sonra (Ozan)

> "Tasarım tarzı webdekinin aynısı olacak ama bazı özellikleri web üzerinden yapacak; kullanıcı mobil app üstünden az işlem sağlayacak."

Veri: PWA prototipindeki kayıtların aynısı (Sevda Q., Dr. Kamran R., REA01–06, KVC01; şifre Demo123!). Yeni kayıt açılmaz.

| Telefonda (az işlem) | Yalnız web'de |
|---|---|
| Giriş (hızlı giriş dahil) | İlaç order ve uygulama çizelgesi |
| İşlerim: öncelik kartı + kaydırarak **Gördüm**, saatli işler + **Yapıldı** işareti | Sıvı dengesi |
| Hastalar: yatak kartları, filtre, arama | Bakım planı |
| Hasta: üst kart (tanı, alerji, izolasyon, skorlar), monitör, Özet, Trendler, **Hekime ulaş** | Sonuçlar, Belgeler, Teslim notu, Kamera |
| Alarm: **Gördüm**, **Eskale** | Formlar (vital giriş, değerlendirmeler), Ölç |
| Bildirim, Profil | Yönetim, raporlar |

Hasta ekranında web'e kalan sekmeler bir "Web panelinde" kartında listelenir: telefonda yoklar, nerede olduklarını söyler.
Aşağıdaki tablo bu karardan önce yazıldı; "Öneri" sütunundaki taşıma önerileri bu karara göre okunmalı.

Okuyan: Ozan. Amaç: Expo uygulamasında PWA'ya göre neyin eksik olduğunu ve her eksiğin **neden** eksik olduğunu tek yerde görmek.

Üç sütunun anlamı:
- **Expo'da** — şu an telefonda var mı.
- **Motor karşılıyor mu** — sunucuda (homunculus-engine) bu işin gerçek verisi / uç noktası var mı. "Var" ise uydurma veri olmadan taşınabilir.
- **Öneri** — ne yapılmalı.

## Kabuk ve genel

| PWA'da | Expo'da | Motor karşılıyor mu | Öneri |
|---|---|---|---|
| Alt menü 5 sekme + orta düğme | ✅ (28.09 iPhone düzeltmesi) | — | — |
| Üst çubuk: sayfa adı, birim · nöbet, arama, zil, baş harfler | ✅ ama "nöbet bitimine" ve kişinin kendi baş harfleri yok | **Var**: `/me` (kişi, rol) | Canlıda `/me`'den ad ve rol |
| Giriş ekranı (koyu marka zemini, tek ekran) | ❌ Giriş Profil'in içinde | Var: `/login`, TOTP | Ayrı giriş ekranı |
| PIN ile hızlı dönüş | ❌ | Kısmen (oturum yenileme var, PIN yok) | Telefonda PIN, arka planda oturum yenileme |
| Kritik alarm tam ekran + ses + titreşim | ❌ (yalnız üstte balon + titreşim) | Var (bildirim akışı) | Tam ekran kritik alarm |
| Bağlantı yok şeridi | Kısmen (üst satırda "Bağlantı koptu") | Var | Şerit + "son veri N dk önce" |
| Rol başına menü (hekim / hızlı yanıt / biyomedikal) | ❌ (yalnız hemşire / hekim seçimi) | Kısmen: roller ve bakım ekibi var | Rol `/me`'den gelsin |

## İşlerim

| PWA'da | Expo'da | Motor | Öneri |
|---|---|---|---|
| Öncelik kartı + kaydırarak Gördüm | ✅ | Var (`/ack`) | — |
| **Eskale** düğmesi | ❌ (Kılavuz konuldu) | **Var**: `/{alert_id}/escalate` | Eklenebilir |
| Ertele | ❌ | **Var**: `/{alert_id}/snooze` | Eklenebilir |
| "Size düştü" — yalnız benim hastalarım | ❌ (bütün koğuş) | **Var**: bakım ekibi (`care-team`, `claim`) | Eklenebilir |
| Saatli işler (pozisyon, ilaç, numune) · geciken iş | ❌ | **Yok** (motorda görev sistemi yok) | Motor işi |
| Devir karşı imza bekliyor | ❌ | Kısmen: `sign-off` var | Değerlendirilecek |

## Hastalar

| PWA'da | Expo'da | Motor | Öneri |
|---|---|---|---|
| Yatak kartları, Hepsi / Dikkat / Stabil | ✅ | Var | — |
| Hasta adı, yaş, tanı | ❌ yalnız yatak | Kısmen: kimlik kaydı canlıda (Comed) | Canlıda kimlik varsa gösterilir (zaten öyle) |
| NEWS2 · SOFA | ✅ (eksik veriyle hesaplanan NEWS2 kartta gizli) | Var | — |

## Hasta ekranı (PWA'da 11 sekme)

| PWA sekmesi | Expo'da | Motor | Öneri |
|---|---|---|---|
| Özet | ✅ | Var | — |
| Trendler | ✅ | Var | — |
| **Skorlar** (SOFA: sistem doldurur, hekim onaylar) | ❌ | **Var**: `/scores/sofa` GET + POST | Taşınabilir |
| Alerji / izolasyon rozetleri, tanı | ❌ | Kısmen: `/clinical/{id}/profile` | İncelenecek |
| Takip · Bakım planı · İlaç · Sıvı · Sonuçlar · Kamera · Teslim notu · Belgeler | ❌ | **Yok** (motorda bu veriler yok) | Motor işi ya da HBYS entegrasyonu |
| Form doldur · Yazdır · Sesli not · Hekime ulaş | ❌ | Yok | Sesli not ve hekime ulaş telefon tarafında yapılabilir |
| Monitör dalgaları (EKG, ART, SpO₂) | Kısmen: EKG "temsili dalga" | Dalga paketleri çözülmedi | Paketler çözülünce gerçek dalga |

## Ölç (orta düğme, hemşire)

| PWA'da | Expo'da | Motor | Öneri |
|---|---|---|---|
| Bileklik QR → vital giriş (4 adım) | ❌ (orta düğme Alarm) | **Yok**: yatak başı ölçüm kaydı yok (`/ingest` cihaz içindir) | Motor işi; gelene kadar Alarm |

## Profil

| PWA'da | Expo'da | Öneri |
|---|---|---|
| Titreşim, tema (otomatik), yazı boyu | ✅ | — |
| Alarm sesi, kritik alarm denemesi | ❌ | Tam ekran alarm ile birlikte |
| Gece odası modu (kısık ışık) | ❌ | Kolay, telefonda |
| İş hatırlatma | ❌ | Görev sistemi gelince |
| Bağlantı kopmasını dene | ❌ | Kolay |
| Çıkış | Kısmen (Sunucu kartında "Oturumu kapat") | Belirgin çıkış düğmesi |

## Özet

- **Telefonda hemen yapılabilir (motor hazır):** Eskale ve Ertele düğmeleri, "yalnız benim hastalarım", Skorlar sekmesi (SOFA onayı), `/me` ile gerçek ad ve rol, ayrı giriş ekranı, tam ekran kritik alarm, gece odası modu, bağlantı şeridi.
- **Motor işi olmadan yapılamaz:** saatli işler, Ölç, ilaç, sıvı, sonuçlar, bakım planı, teslim notu, belgeler.
- ⚠️ Motorla konuşan yeni özellikler **yalnız canlı modda** çalışır. Kayıttan oynatmada (şu anki test düzeni) görünmezler. Bunları denemek için telefonun gerçek sunucuya bağlanması gerekir.
