# Infinity dalga formu blokları — 27 Ekim 2026

Dräger Infinity multicast yükündeki dalga formu verisinin yapısı. Sayısal kayıtların karşılığı
[INFINITY-PARAMETER-RECORDS.md](INFINITY-PARAMETER-RECORDS.md)'dedir. Bu belge yapıyı ve
doğrulamanın düzeyini kaydeder; **hasta ölçüm değerleri buraya yazılmaz**.

Çözüm, depo dışında saklanan mevcut kayıtlar üzerinde çevrimdışı yapıldı: 19 Eylül'de `.27`
cihazından alınan iki doğrudan Ethernet kaydı (EKG takılmadan önce ve sonra, 300'er saniye),
aynı gün VM üzerinden alınan 60 saniyelik kayıt ve 21 Eylül'de `.28`'den alınan iki 60
saniyelik kayıt (biri monitör ekranının videosuyla birlikte). Yeni ağ trafiği yakalanmadı.

## Paket

Her cihaz `2564` kaynak portundan kendi grubuna (`224.0.2.<x>:2050`) **200 ms'de bir** paket
gönderir (saniyede 5). Her paket 64 baytlık bir başlıkla başlar; **29. bayt mesaj türüdür**:

| Tür | Sıklık | İçerik |
|---|---|---|
| `0x03` | saniyede 4 | yalnız dalga blokları |
| `0x0a`, `0x09`, `0x08`, `0x04` (cihaza göre) | saniyede 1 | aynı dalga blokları, ardından sayısal kayıt bölümü |

Yani dalga verisi **her pakette** vardır; sayısal kayıtları taşıyan paket de o 200 ms'nin
örneklerini taşır. Önceki belgelerdeki "522/468/346 baytlık dalga formu paketleri" ayrı bir
biçim değildir: tür `0x03` paketinin boyu, o yatakta bağlı dalgaların toplamından ibarettir.

## Dalga bloğu

Başlıktan (64. bayttan) sonra bloklar boşluksuz art arda dizilir ve paketin (ya da kayıt
bölümünün) başına tam oturur. Blok içinde, sıfır tabanlı, big-endian:

| Bayt | İçerik |
|---|---|
| 0–1 | örnekleme hızı, Hz (`200`, `100`, `50`) |
| 2–3 | blok boyu, bayt (= 14 + 2n) |
| 4–5 | saniye içindeki milisaniye (`40`, `240`, `440`, `640`, `840`) |
| 6–9 | cihaz saati, saniye (duvar saatiyle ilişkisi kurulmadı) |
| 10–11 | **dalga kimliği** |
| 12 | örnek sayısı n (= hız × 0,2) |
| 13 | `0` |
| 14… | n adet örnek, signed int16 |

Blok zamanı `saniye + ms/1000`'dir; ardışık bloklar tam 0,2 s arayla gelir. Kayıtlarda boşluk,
tekrar ya da çakışma görülmedi (60 s'de 300, 300 s'de 1501 blok, her dalga için).

**Örnek değeri `0x0001` "sinyal yok" demektir** (derivasyon bağlı değil, kanal kapalı): o
kanaldaki bütün örnekler bu değeri taşır. Bu değer **düz çizgi olarak çizilmemelidir** — düz
EKG çizgisi asistoli gibi okunur; "sinyal yok" boşluğu olarak gösterilir.

## Dalga kimlikleri

| Kimlik | Hız | Anlam | Kanıt |
|---|---|---|---|
| `0x0103` | 200 Hz | EKG, ekranda **II** derivasyonu | ekranda yalnız II çiziliyordu ("RL Lead OFF"); paketlerde de yalnız `0x0103` canlıydı. R-R'den hesaplanan HR kayıttaki HR ile 1–3 atım/dk içinde |
| `0x0102`, `0x0104` | 200 Hz | EKG, büyük olasılıkla I ve III | gözlenen yataklarda hep `0x0001`; **doğrulanmadı** |
| `0x0122`, `0x0124` | 200 Hz | EKG (V derivasyonları olabilir) | hep `0x0001`; **doğrulanmadı** |
| `0x0301` | 100 Hz | arteriyel basınç (ART) | **mmHg = örnek / 40** — aşağıya bakın |
| `0x1916` | 100 Hz | pletismogram | tepe aralığı kayıttaki nabızla örtüşüyor; birim yok (göreli) |
| `0x0201` | 50 Hz | impedans solunumu | periyodu kayıttaki RESP ile ±1/dk; EKG elektrotları takılınca canlanıyor |

Kimlik önekleri sayısal kayıtlarınkiyle aynı aileyi izliyor: `0x03` ART, `0x02` impedans
solunumu, `0x19` SpO₂ modülü.

## ART ölçeği

Arteriyel dalganın vuru başına tepe ve dip değerleri, aynı 10 saniyelik pencerelerdeki
`art_systolic` / `art_diastolic` kayıtlarına doğrusal olarak uyduruldu. İki bağımsız kayıtta
eğim **1/40,17** ve **1/40,80** çıktı; ölçek tam 1/40 alındığında kalan ofset **0,3 ± 1,8** ve
**0,5 ± 2,1 mmHg**. Sonuç: örnek değeri 40'a bölününce mmHg verir (0,025 mmHg/birim), sıfır
ofsetle. Bu, ekran olmadan çalışan yapısal bir doğrulamadır; MAP bağıntısının dalga karşılığı.

## Doğrulamanın düzeyi

Kanıtlanan:
- Blok yapısı, zamanlama ve süreklilik (bütün kayıtlarda istisnasız).
- Kanallar aynı hastaya ait ve zamanca hizalı: aynı erken atım EKG, ART ve pleth'te, fizyolojik
  gecikmesiyle, aynı anda görülüyor.
- Dalgadan türetilen HR, nabız ve solunum hızı monitörün kendi sayılarıyla örtüşüyor.
- ART'ın mmHg ölçeği.
- Ekrandaki canlı derivasyon (II) ile `0x0103`'ün tek canlı EKG kanalı olması örtüşüyor.

Kanıtlanmayan:
- **Örnek düzeyinde ekran eşleşmesi.** Elde tutulan videoda ekrandaki QRS zamanları ile
  çözülen R tepeleri hizalandı; en iyi hizada eşleşen atımların sapması 44 ms, erken atım da
  eşleşiyor. Ama düzenli ritimde bir atım kaydırılmış hiza da aynı puanı aldı, yani hiza tek
  değil. Planlı bir kayıt gerekir (sabit kamera, 90 sn+, ART'lı yatak dahil).
- **EKG genliği.** Ekrandaki 0,5 mV çubuğundan kaba tahmin birim başına 0,5–0,8 µV; kalibrasyon
  değildir. Çizim göreli genlikle yapılır, mV ızgarası çizilmez.
- I, III ve V derivasyonlarının kimlikleri.
- Cihaz saatinin duvar saatiyle ilişkisi.

## Yan akışlar

Aynı cihaz iki ayrı multicast grubuna daha yayın yapıyor. Worker bu gruplara **katılmıyor**;
yalnız doğrudan Ethernet kaydında görüldüler.

- **`2150` → `224.127.2.255:2150`, ~20 saniyede bir.** UTF-16BE metinler: cihaz adı
  (`…ICU.MU2.BONADEA.`), **yatak adı** (`.27` için `BED10`, envanterdeki eşlemeyle aynı),
  yazılım sürümü (`VF9.1-C`), 5 harflik bir metin ve 10 haneli bir sayı. Önceki belgelerdeki
  "yatak adı yayında yok" ifadesi yalnız `2050` akışı için doğrudur. **10 haneli sayı hasta
  numarası olabilir: kaydedilmez, loglanmaz, gösterilmez**; ne olduğu doğrulanmadan bu akış
  yalnız yatak adı için, alan alan izinle okunmalıdır.
- **`2000` → `224.127.2.254:2000`, saniyede 1.** Etkin alarm ve teknik uyarı metinleri
  ("ECG Leads Invalid", "HR > 160", "… Alarm at BED10" gibi). Aşama C için ayrı bir araştırma
  konusu.

## Sayısal kimlikler hakkında bir şüphe

Dalga kimliklerinde `0x01` öneki EKG'ye, `0x19` öneki SpO₂ modülüne ait. Bu, sayısal kayıtlarda
`0x0101`'in EKG'den gelen **HR**, `0x1905`'in ise SpO₂'den gelen **nabız (PLS)** olabileceğini
düşündürüyor — `infinity_records.py`'deki `hr`/`pls` adlarının tersi. Gözlenen yataklarda HR ile
PLS eşit olduğu için ayırt edilemedi. HR ile PLS'nin farklı gösterildiği bir yatakta (aritmi,
zayıf perfüzyon) ekranla kontrol edilmelidir.

## Sınırlar

- Bu bir klinik decoder değildir. Dalgadan hiçbir alarm, skor, ölçüm ya da bildirim üretilmez;
  birincil alarm başucu monitörüdür.
- Ham kayıtlar ve çözülmüş örnekler depo dışında kalır (`C:\Users\User\Desktop\Homunculus-Captures`);
  test verisi sentetiktir.
