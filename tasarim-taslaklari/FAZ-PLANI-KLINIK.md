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

## İlerleme
- [x] Faz 1 planlandı — numune akışı kuruluyor.
