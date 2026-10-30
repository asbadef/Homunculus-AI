# Infinity parametre kayıtları — 22 Eylül 2026

Dräger Infinity multicast yükü, sabit bir ofset tablosu değil; **36 baytlık parametre
kayıtlarından oluşan bir dizi** taşıyor. Her kayıt kendi parametre kimliğini ve birim
kodunu içeriyor. Bu, cihaz başına ofset profili gereksinimini ortadan kaldırıyor.

Bu belge protokol yapısını kaydeder. **Hasta ölçüm değerleri buraya yazılmaz.**

## Kayıt yapısı

Kayıt içinde, sıfır tabanlı:

| Bayt | İçerik |
|---|---|
| 0–1 | değer, big-endian uint16 |
| 2–3 | alarm üst limiti, signed int16 |
| 4–5 | alarm alt limiti, signed int16 |
| 10–13 | zaman damgası (cihaz saati; doğrulanmadı) |
| 16–19 | ikinci zaman damgası |
| **20–21** | **parametre kimliği** |
| **22** | **geçerlilik bayrağı: `0` geçerli, `1` geçersiz** |
| **24** | **birim kodu** |

Kayıtlar art arda dizilidir. Dizinin başlangıç ofseti cihaza ve aktif modüllere göre
değişir; dizi, kimlik ve birim alanları geçerli olan 36 baytlık hizalı bloklar aranarak
bulunur. Ölçüm taşımayan bayrak kayıtları da dizinin içindedir ve bilinmeyen birim
kodları taşıyabilir; bu yüzden dizi "kesintisiz geçerli kayıt" olarak değil, hizalamaya
göre aranır.

## Doğrulanmış kimlikler

Doğrulama yöntemi: merkezi istasyon ekranındaki parametre etiketleri ve değerleri, aynı
zaman aralığında alınan kayıtla karşılaştırıldı. Aşağıdaki kimlikler için ekranda
gösterilen değer ile kayıttaki değer **birebir aynıydı**.

| Kimlik | Parametre | Birim kodu | Doğrulama |
|---|---|---|---|
| `0x0101` | HR (EKG) | `0x1a` atım/dk | BED08'de planlı kayıt + video, iki değer farklıyken (27.10.2026) |
| `0x1905` | PLS (SpO₂ nabzı) | `0x1a` | BED08'de planlı kayıt + video, iki değer farklıyken (27.10.2026) |
| `0x190e` | SpO₂ | `0x1c` % | iki cihazda ekranla birebir |

**27.10.2026 düzeltmesi (HR/PLS):** ilk eşleme `0x1905` = HR, `0x0101` = PLS idi ve "iki cihazda ekranla
birebir" diye kaydedilmişti. BED08'de HR ile PLS farklıyken alınan planlı kayıt ve video bunun **ters**
olduğunu gösterdi: `0x0101` ekrandaki HR (EKG), `0x1905` ekrandaki PLS (SpO₂ nabzı). İlk karşılaştırmada iki
değer büyük olasılıkla eşitti, bu yüzden fark görünmedi. Kod düzeltmesi taşıma sürümü R6'dadır.
| `0x1f0f` | etCO₂ | `0x09` mmHg | iki cihazda ekranla birebir |
| `0x1a0b` | Ta (sıcaklık) | `0x11` °C | ekranla birebir, **onda bir ölçekli** |
| `0x0307` | ART diyastolik | `0x09` | MAP kimliği + ekran eğilimi |
| `0x0308` | ART sistolik | `0x09` | ekranla birebir |
| `0x0309` | ART ortalama | `0x09` | MAP kimliği, 150 pakette ≤3 mmHg |
| `0x1e07` | NBP diyastolik | `0x09` | ekranla birebir |
| `0x1e08` | NBP sistolik | `0x09` | ekranla birebir |
| `0x1e09` | NBP ortalama | `0x09` | ekranla birebir |
| `0x1f06` | RESP (hava yolu) | `0x1b` sol/dk | **doğrulanmadı** — gözlenen yataklarda ekranda yok |
| `0x0206` | RESP (impedans) | `0x1b` | ekranda RESP gösteren yatakta aralık örtüşmesiyle |

İki RESP kimliği ayrı kaynaklardır: `0x1f` öneki kapnografi modülüyle, `0x02` öneki EKG
impedansıyla birlikte görülüyor. İkisi de birim kodu `0x1b` ve 5–30 alarm sınırı taşıyor.
Hangisinin ekranda "RESP" olarak gösterildiği, RESP gösteren bir yatakta doğrulanmalıdır.

Birim kodu, kimlikten bağımsız bir çapraz kontroldür: HR ve PLS aynı kodu, üç basınç
alanı aynı kodu paylaşıyor. Bu, kimlik eşlemesinin tesadüf olmadığını gösteriyor.

## Geçerlilik bayrağı

Kayıt içindeki **22. bayt**, değerin anlamlı olup olmadığını cihazın kendisi bildirir:
`0` geçerli, `1` geçersiz. Geçersiz kayıtlarda değer alanı yer tutucu bir sayı taşır;
bu sayıyı ölçüm sanmak, ekranda `***` gösterilen bir parametreyi sayıymış gibi göstermek
demektir.

Doğrulama: merkezi istasyonda bütün sürekli parametreleri `***` gösteren yataklarda,
ilgili kayıtların tamamı bayrağı `1` taşıyordu; aynı yatakta en son ölçülen NBP değeri
ekranda duruyordu ve onun kaydı bayrağı `0` taşıyordu. Yani bayrak, ekranın davranışıyla
birebir örtüşüyor.

Bir cihazda aynı parametrenin paketlerin yalnız bir kısmında geçerli geldiği görüldü
(mesaj türüne göre değişiyor). Okuyucu bu yüzden **parametre başına en son geçerli kaydı**
almalıdır; geçersiz bir kayıt, o parametrenin yokluğu değil, o mesajda taşınmadığı
anlamına gelir.

Bu bulgu, önceki belgelerde açık bırakılan "geçerlilik/sentinel bitleri belirsiz"
sorusunu kapatır.

## Alarm sınırları

Her kayıt kendi alarm alt/üst sınırını taşır (2–3 ve 4–5. baytlar, signed int16). Bunlar
cihazda o hasta için ayarlanmış sınırlardır; hastaya göre farklılık gösterdikleri
gözlendi. Bu, sabit eşik yerine hastaya göreli eşik gerektiren çalışma için doğrudan
kullanılabilir bir veri kaynağıdır — ayrı bir doğrulama işi olarak ele alınmalıdır.

## MAP kimliği

Arteriyel üçlü için `ortalama ≈ (sistolik + 2 × diyastolik) / 3` bağıntısı, iki ayrı
kayıtta 150 pakette **en fazla 3 mmHg** sapmayla sağlandı. Ölçülen ortalamanın formülden
birkaç mmHg yüksek çıkması beklenen davranıştır. Bu, ekran olmadan da çalışan bir
yapısal doğrulamadır ve üç alanın birbirine göre konumunu bağımsız olarak teyit eder.

## Standby davranışı

Standby'daki bir monitör **yayın yapmaya devam ediyor** (~5 pps) ama hiçbir parametre
kaydı taşımıyor; paket uzunlukları da kısalıyor. Doğrulandığı cihaz: `10.10.203.28`,
kullanıcı tarafından BED07 olarak ve standby durumunda teyit edildi.

Sonuç: **"paket geliyor" ile "ölçüm var" aynı şey değildir.** Araştırma ekranı bu ikisini
ayrı göstermek zorundadır; aksi hâlde standby bir yatak "bağlantı var, veri yok" yerine
sessizce boş görünür.

## Önceki yaklaşımın geçersizliği

`bed09-26-partial-unverified-v3` profili sabit ofsetlere dayanıyordu ve **iki eşlemesi de
yanlıştı**: `744@528` `spo2_candidate` olarak etiketlenmişti, gerçekte arteriyel
diyastolik basınçtır; `1422@1350` `pls_candidate` olarak etiketlenmişti, gerçekte her
pakette sabit `1` taşıyan bir alandır. Etiketler `.28` cihazından taşınmış ve hedef
cihazın kendi verisiyle hiç doğrulanmamıştı.

Sabit ofset yaklaşımı ayrıca yapısal olarak kırılgandır: `10.10.203.26` (arteriyel hatlı)
ile `10.10.203.29` (arteriyel hatsız) cihazlarının paket uzunlukları ve kayıt dizisi
başlangıçları farklıdır. Bir hastaya arteriyel kateter takıldığında o cihazın bütün
ofsetleri kayar ve profil sessizce yanlış alan okumaya başlar.

## Sınırlar

- Zaman damgası alanlarının cihaz saatiyle ilişkisi çözülmedi. Merkezi istasyon saati
  yerel saatten yaklaşık **bir saat geride**; cihaz zamanı hizalama için kullanılmamalıdır.
- Yatak etiketi bu akışta **yok**. Cihaz adresten tanımlanır; yatak adı ayrı ve
  doğrulanmış bir kaynaktan gelmelidir.
- Cihaz↔yatak eşlemesi ekran karşılaştırmasıyla dört cihazda kuruldu, envanterin
  tamamı için değil. Eşleme protokolden gelmez; doğrulanmış ayrı bir kaynak gerekir.
- Bir cihazda yalnız `ART_map` okunabildi; o cihazın mesaj düzeni tam çözülmedi.
- Bu bir klinik decoder değildir. Klinik ingest kapalıdır ve bu bulgular tek başına
  klinik kullanım için yeterli doğrulama sayılmaz.
- **Aşama A şeridi (19 Ekim 2026'dan beri).** Bu kayıtlardan çözülen değerler klinik panoda
  "Monitör · doğrulanmamış" başlıklı, kesik çizgili bir şeritte gösterilir; yalnız görüntüdür.
  Hiçbir alarm, skor (NEWS2 dahil), bildirim ya da ses bu değerlerden üretilmez; birincil alarm
  başucu monitörünün kendisidir. Her değerin yanında saniye cinsinden yaşı ve kanıt düzeyi,
  ekranda göründüğü sözcüklerle yazılıdır: "İki cihazda monitör ekranıyla birebir", "Monitör
  ekranıyla birebir; ölçüm yeri bilinmiyor", "Tek yatakta aralık örtüşmesi; ekranla birebir
  değil", "MAP bağıntısı ve ekran eğilimi", "Yalnız yapısal kontrol (MAP bağıntısı); ekranla
  karşılaştırılmadı". Kısmi doğrulanan parametre "KISMİ" rozeti taşır; hangi parametrenin hangi
  düzeyde olduğu Ayarlar'daki açıklamada ve Aşama A planının tablosundadır. Cihazın geçersiz
  işaretlediği değer sayı olarak değil `***` olarak çizilir.
- **NBP şeritte, değerinin son değiştiği saatle (NBP dilimi, hub sürümü R4).** Son NBP her pakette
  geçerli kayıt olarak yinelenir (yukarıda "Geçerlilik bayrağı") ve cihaz zaman damgası
  çözülmediği için paketin yaşı manşonun ne zaman ölçtüğünü söylemez. Hub bunun yerine, cihaz
  başına (sistolik, diyastolik, ortalama) üçlüsünün **değiştiği** paketin alınış saatini tutar:
  ölçüm o anda ya da daha önce olmuştur, saat bir **üst sınırdır** ve şerit "ölçüm ≤ SS:DD (N dk)"
  yazar. Değişiklik, ancak bir önceki tam ve geçerli üçlü en çok 3 saniye önce gelmişse saatini
  alır; daha uzun bir boşluktan sonra (ağ ya da cihaz kesintisi, `***` ya da eksik bileşenli
  paketlerle geçen bir süre) görülen değişikliğin saati bilinmez, çünkü boşluğun herhangi bir
  anında olmuş olabilir. Gösterilen saat, hub saatine göre, gerçeğinden en çok 3 saniye yeni
  olabilir; işçi ile API saatleri arasındaki en çok 2 saniyelik kayma şeritteki her yaş için
  aynıdır. Hub yeniden başladıktan sonra, ya da değer böyle bir boşluk sırasında değiştiyse, NBP
  değeri değiştiren bir sonraki ölçüme kadar gösterilmez ("— ölçüm bekleniyor"); aynı değer bir
  kesintiden sonra geri gelirse eski, hâlâ doğru saatiyle hemen görünür. Değeri 2 saatten uzun
  süredir değişmemiş NBP gösterilmez ("— eski · 3 sa"): API bunu 2 saatten 15 saniye önce
  (tarayıcının bir değeri gösterme penceresi) keser ki hiçbir ekranda NBP 2 saati geçmesin. Aynı
  değerle yinelenen bir ölçüm fark edilmez: saat gerçeğinden eski kalır, hiçbir zaman yeni değil.
  Üç bileşen tek bir pakette, geçerli ve tam gelmelidir; eksik ya da `***` bileşenli paket ne
  değişiklik sayılır, ne tutulan üçlüyü siler, ne de 3 saniyelik süreyi başlatır ya da sürdürür.
  Hastanın değiştiği bir yatakta önceki hastanın NBP'si, yeni ölçüme ya da 2 saate kadar
  görünebilir; cihaz→hasta bağı geldiğinde (Aşama B) bağ değişince NBP sıfırlanacak.

## Uygulama ve dağıtım — 22 Eylül 2026

Okuyucu `homunculus-engine/src/homunculus/edge/infinity_records.py` içindedir ve profil
almaz. Kayıt dizisini hizalamadan bulur; bir konumun kayıt sayılması için üç bağımsız
koşul birlikte sağlanmalıdır: kimlik bilinmeli, birim kodu o kimliğin taşıdığı kod olmalı,
ve alarm sınırları ters olmamalıdır. Tek başına her biri şans eseri tutabilir; üçü birden
tutmaz. Bu kural olmadan tarama, "santigrat cinsinden nabız" gibi satırlar üretiyordu.

`infinity_live.py` artık cihaz başına durum tutar. Korunanlar: alan başına 3 saniyelik
tazelik, gelecek-zaman reddi, gecikmiş/tekrar eden outbox kaydının canlı ölçüm sayılmaması,
ve `clinical_*` bayraklarının kapalı kalması. Şema `homunculus.infinity-preview.v3`.

Cihaz durumu **son pakete göre değil, parametrelerin bütününe göre** belirlenir. Bu, saha
dağıtımında yakalandı: bir yatak araya kayıt taşımayan dalga formu paketleri gönderiyor ve
son pakete bakan durum, on parametresi taze olan bir yatağı "parametre yok" diye
raporluyordu. Test: `test_a_waveform_payload_between_readings_does_not_flip_the_device_status`.

Hub'a `records-095b3b64a508beb7` release'i ve `70-records.conf` drop-in'i ile dağıtıldı;
yalnız hub yeniden başlatıldı. Önceki release'ler ve drop-in'ler yerinde duruyor; geri
dönüş için `70-records.conf` silinip `daemon-reload` ve restart yeterlidir.

Dağıtım sonrası doğrulama: `evidence=record_decoded`, üç cihaz için `rejected=0`,
`old_or_duplicate=0`; arteriyel hatlı yatak on parametreyi `candidate` ve taze veriyor;
standby iki yatak `no_parameters` veriyor. `--unverified-live-research` bayrağı artık
profil yolu almaz, ancak eski birim dosyaları önyüklemede hata vermesin diye verilen yolu
kabul edip yok sayar.

Testler: `tests/test_infinity_records.py` (14) ve `tests/test_infinity_live.py` (12).
Hepsi sentetiktir; hiçbir hasta değeri veya saha kaydı test verisine girmez.

## Production dağıtımı — 22 Eylül 2026, ~12:08 UTC

Dal `feat/infinity-production-integration` (`97f8bde`, taban `873cbe2`) hub host'una git
bundle ile taşındı ve `/opt/homunculus` o dala alındı. `web` ve `api` imajları VM'de
derlendi; yalnız bu iki container yeniden yaratıldı (`postgres`, `bridge`, `nce`, volume'lar
dokunulmadı). Önceki imajlar geri dönüş için: web `41e720ea7ef8`, api `057bbea76f89`.

Yapılandırma: `.env`'e `INFINITY_HUB_URL`, `INFINITY_VIEWER_TOKEN` (hub'ın **viewer**
kimliği), `INFINITY_HUB_CA_FILE`, `INFINITY_HUB_CA_HOST_PATH` eklendi; hub'ın public CA'sı
`/etc/homunculus/infinity-ca.pem` olarak (644) kopyalandı — hub config dizini mount
edilmedi, orada collector token ve TLS özel anahtarı da var.

Doğrulama (kimlik doğrulamasız ve container içinden):
- `GET /infinity-research/state` token'sız → 401 JSON. Nginx yolu API'ye gidiyor; SPA
  fallback'e düşmüyor.
- API container'ından `fetch_state`: 13 cihaz, `evidence=record_decoded`,
  `clinical_ingest_enabled=false`, ret 0; altı yatak 6–10 parametre ve ~2 dakikalık trend.
- Servis edilen bundle paneli içeriyor; `/health` 200; API log'unda hata yok.

Tarayıcı oturumuyla görsel doğrulama kullanıcı tarafından yapılır (BIOMEDICAL veya
HOSPITAL_ADMIN, "Cihaz & Veri Akışı"). Bu belge yazıldığında henüz yapılmamıştı.

Envanter 13 cihaza çıkarıldı ve journal boyutu buna göre ayarlandı: 256 MiB / 200.000 satır
/ 900 s tutma. Eski değerlerle (128 MiB / 100.000 / 3600 s) 13 yatak × 5 pps kapasiteye
yaklaşık 28 dakikada çarpar ve hub 507 döndürürdü.

Gösterilen "diagram", parametre değerlerinin zaman içindeki trend çizgisidir. Monitördeki
EKG/pleth dalga formu **çizilmez**; dalga formu paketleri (`522/468/346` bayt) çözülmedi ve
bunların dalga formu olduğu iddia edilmez. Ayrı iştir.

## Yatak adları ve bir işletim tuzağı — 22 Eylül 2026, 12:20 UTC

Yatak adı yayında yoktur; envanterdeki `id` alanı taşır ve yalnız merkezi istasyon ekranıyla
doğrulanmış eşlemeler için yazılır: `BED06=.29`, `BED07=.28`, `BED08=.37`, `BED09=.26`.
Diğer dokuz cihaz adres türevli kimlikte kalır ve ekranda "Yatak eşlenmedi" olarak görünür.
Koğuş envanteri `deploy/infinity/inventory.icu2.json` olarak repodadır.

**Tuzak.** Bir cihazın `id`'si değiştirildiğinde, önce hub yeniden başlatılırsa worker'ın
outbox'ında eski kimlikle üretilmiş olaylar kalır; hub bunları reddeder (`device.id !=
event["device_id"]`, HTTP 400), collector 400'ü "sonra dene" sayar ve kuyruğun başı sonsuza
dek tıkanır — yeni olaylar arkada bekler, `forward_errors` artar. Bu tam olarak yaşandı:
7006 satır, 108 sn, sıfır kabul. Karışık kuyruk (eski + yeni kimlik) hiçbir envanterle
boşaltılamaz; tek çıkış outbox'ı kenara almak oldu (`wedged-<zaman>-outbox.sqlite` olarak
saklandı, ~2 dakikalık araştırma taşıma verisi; hub zaten 900 sn tutuyor).

**Doğru sıra (kimlik değişikliği için):** worker'ı durdur → outbox'ın boş olduğunu doğrula
(`/v1/status` → `queue_rows=0`; boş değilse worker'ı eski envanterle çalıştırıp boşalt) →
iki envanteri değiştir → hub'ı başlat → worker'ı başlat. "Hub önce" kuralı **şema
eklemeleri** içindir (yeni sayaç adı gibi); kimlik yeniden adlandırması için yeterli değildir.

**Açık düzeltme:** collector, hub'ın 400 ile reddettiği bir batch'i zehirli sayıp
karantinaya almalı (kuyruğu tıkamamalı); ya da hub olayı `(source, group, port)` ile eşleyip
etiket alanını görüntü meselesi olarak yok saymalı. İkisi de test gerektirir; yapılmadı.
