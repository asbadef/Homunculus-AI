# HBYS Prototip — Klinik Faz Planı (doktor · hemşire · lab) · 25.10.2026

Sahip tüm rol gruplarını (vezne, hasta kabul, randevu, danışman, doktor, hemşire) + referans görseller + videolar verdi.
Amaç: her rolün süreci uçtan uca aktif, **admin kontrol edilebilir/düzenlenebilir**, **yetkisiz kullanıcı yapamaz**.
Sahip tek başına kayıt açıp test edecek; hata/eksik bildirecek, düzeltilecek.

Kaynak: `DOKTOR-SUREC-ANALIZ.md`, referans CoMed görselleri, kod taraması.

## Kural (her yeni süreçte)
- **Yetki (perm):** her ekran/aksiyon perm ile kilitli; yetkisiz rol göremez/yapamaz.
- **Admin:** ilgili tanım/parametre admin ekranından düzenlenebilir; değişiklik denetim kaydına yazılır.
- Sentetik veri, PHI yok. Kalıcılık PERSIST_KEYS. Azerbaycan: Medula/SUT/e-Nabız yok → SAMHI/TƏBİB `[AZ]`.

## Durum envanteri (kod taramasıyla)
### Zaten VAR
- **Doktor:** Muayene (zengin `docs.js`), Doktor İş Listesi (`drislem`), İstem (`H.orders`), Reçete, Tanı (ICD), Epikriz, Tedavi alt sekmeleri.
- **Hemşire:** Görev çizelgesi (`tasks`), bedside, body map (`H.body`), NEWS2, klinik formlar (`H.forms`), vital, bakım planı (`H.carePlan`), ilaç uygulama (`H.medAct`), hemşire notu.
- **Paylaşılan:** hasta360, patient (ICU), alarms, teslim (`hand`), monitor.

### KISMİ / EKSİK (referans görsellerden)
| # | Süreç | Durum | Yetki | Admin |
|---|-------|-------|-------|-------|
| F1 | **Numune (örnek) akışı** — order → Numune Oluştur → no+tüp+lab → Bekliyor/Alındı/Kabul/Red/Tekrar | **EKSİK** | hemşire al / laborant kabul | numune/tüp tanımı |
| F2 | **Lab teknikeri** — kabul/red + sonuç girişi, durum sekmeleri | KISMİ (`labislem` var, numune yok) | lab_islem | test/lab tanımı |
| F3 | **Radyoloji teknikeri** — çekim/rapor | EKSİK | (yeni) rad_islem | rad tanımı |
| F4 | **Sıvı İzlem** (Aldığı/Çıkardığı flowsheet) | KISMİ | tasks | — |
| F5 | **Vaka Takip** (Düşme/İzolasyon vaka listesi) | EKSİK | tasks/results | vaka tipi |
| F6 | **Hemşire Shift/Atama** (hasta-yatak-hemşire) | EKSİK | (yeni) hemsire_ata | — |
| F7 | **Yatan Hastalar** + Yatış/Taburculuk/Servis(yatak değişikliği) istem | KISMİ | admission/beds | birim/yatak |
| F8 | **Protokol İşlem** (hizmet/malzeme kullanım + Hastaya Çıkış depo) | KISMİ | results | depo/stok |
| F9 | **Faaliyet/Olay/Bakım** aktivite kataloğu | KISMİ | tasks | aktivite tanımı |
| F10 | Muayene üst barı / hasta başlığı sadeleştirme (kırmızı işaret) | BEKLEMEDE | — | — |
| F11 | **Admin + yetki kapsama turu** — yeni her ekran admin'de + yetki kataloğunda | SÜREKLİ | admin_* | — |

## Faz sırası
- **Faz 1 (şimdi): Numune akışı (F1)** — sahip özellikle istedi; lab teknikeri köprüsü.
- **Faz 2: Lab teknikeri (F2)** — sahip süreci anlatınca.
- **Faz 3: Radyoloji (F3)** — sahip anlatınca.
- **Faz 4: Hemşire derinliği (F4/F5/F9).**
- **Faz 5: Yatan/servis (F6/F7/F8).**
- **Faz 6: Admin+yetki kapsama turu (F11) + üst bar (F10).**

Her fazdan sonra: smoke 0 hata, commit, sahip test/bildirim, düzeltme.

## Eczane / stok fazı (referans görsellerden — 25.10 akşam)
Eczane referansı zengin: Order Değerlendirme, İlaç Talep Karşılama, Onay Bekleyen İşlemler (teslim/gönderilen/iade), Hasta Stok, Order Analiz, Miadı Geçen/Yaklaşan, İlaç Listesi (tam ilaç kartı: fiyat/SUT/eşdeğer/depolama/tedarikçi/barkod/bağlı hizmet), Hasta Reçete Bilgisi, İade/Zayi, ITS/karekod, pharmacy-extended order akışı (Bekliyor→Onaylandı→Transfer→Reddedildi→İptal; İşlemi Al; Onayla/Transfer/Reddet; Vademecum DDI etkileşim sorgulama; muadil seçimi).
| # | Süreç | Durum |
|---|-------|-------|
| F-E1 | **İlaç kataloğu içe aktarma** (ilaç.xlsx→H.ILAC 1500) + admin İlaç Listesi + İstem seçimi | **[x] bitti (v0215)** |
| F-E2 | Eczane order karşılama (Bekliyor/Onayla/Transfer/Reddet + muadil + karşılanan miktar) | mevcut `pharmacy` ekranı var, referans derinliği yok |
| F-E3 | Vademecum DDI / etkileşim sorgulama (ilaç-ilaç, gebelik, tanı) | EKSİK |
| F-E4 | İlaç kartı derinliği (etken madde, eşdeğer/muadil, depolama, tedarikçi, SUT, barkod/karekod) | EKSİK (şu an 6 alan) |
| F-E5 | Stok/depo: hasta stok, miadı geçen/yaklaşan, kritik stok, iade/zayi, ITS | EKSİK/kısmi |

## Uçtan uca hedef (sahibin isteği)
Bir hasta hastaneye gelir → kabul → randevu/muayene → istem (lab/rad/ilaç) → numune → sonuç → tedavi/ilaç uygulama → eczane karşılama → fatura/vezne → taburcu/epikriz. **Her adım yetki-kilitli, admin'den yönetilebilir, veriler rapora tutarlı yansır.** Kalan kopukluklar yukarıdaki fazlarda.

## İlerleme
- [x] Faz 1: Numune akışı (v0214).
- [x] F-E1: İlaç kataloğu + admin İlaç Listesi + İstem seçimi (v0215).
- [ ] Sırada: sahip lab/radyoloji tekniker sürecini anlatacak → F2/F3. Paralelde eczane derinliği (F-E2..E5), hemşire derinliği (F4/F5), yatan/servis (F6/F7), admin+yetki kapsama turu, veri-rapor tutarlılık denetimi.
- **Not (unutulmasın):** üst bar sadeleştirme (F10), İş Listesi sayaç tıklanır filtre, lab/rad sonuç trend+anormal vurgu, numune ayrı ekran (hemşire/laborant), Finansal durumu gerçek faturaya bağlama, hizmet listesi.xlsx + tanı listesi.xlsx + formlar.xls + yetki.xls içe aktarma.
