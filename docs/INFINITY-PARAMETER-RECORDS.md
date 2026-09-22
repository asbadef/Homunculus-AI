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
| `0x1905` | HR | `0x1a` atım/dk | iki cihazda ekranla birebir |
| `0x0101` | PLS | `0x1a` | iki cihazda ekranla birebir |
| `0x190e` | SpO₂ | `0x1c` % | iki cihazda ekranla birebir |
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
