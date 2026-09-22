# Homunculus VM kontrolü — 22 Eylül 2026

Salt okunur SSH incelemesi: `sysadmin@172.100.101.72`, yaklaşık 07:41–07:46 UTC.
Uzak dosyalar, servisler, container'lar ve ayarlar değiştirilmedi.

## Kurulu durum

- Ubuntu 24.04.4; yaklaşık 27 gündür açık. Kök diskte 6.7 GiB boş, kullanım %71;
  kullanılabilir RAM yaklaşık 5.8 GiB. Saat NTP ile eşzamanlı; failed systemd unit yok.
- `homunculus-web`, `homunculus-api`, `homunculus-bridge`, `homunculus-postgres`
  çalışıyor. API ve Postgres healthy; web/API restart sayısı sıfır.
- Production web imajı `41e720ea7ef89…`, container başlangıcı 21 Eylül 04:49 UTC.
  API imajı `057bbea76f89…`, başlangıcı 20 Eylül 19:25 UTC.
  Compose dizini `/opt/homunculus/deploy/local`.
- HTTP 8080 üzerinden `/health`: 200 JSON. Web 8080/8443, hub 8766 üzerinde.

## Decoder zaten kurulmuş

`homunculus-infinity-pilot-hub.service` active/running ve enabled; başlangıç
22 Eylül 07:37:54 UTC, NRestarts=0. Etkin drop-in dosyaları 30, 40 ve 50.

Etkin release: `/opt/homunculus-infinity/decoder-bed09-54b0ad30fe827d82`.
Profil: `bed09-26-partial-unverified-v3`, kaynak `10.10.203.26`, mode=live.
Decoder, live, hub, stream, collector, journal ve runner dosyalarının SHA-256
değerleri satır sonları normalize edilerek yerel kaynakla karşılaştırıldı: 7/7 aynı.
VM'deki ZIP SHA-256 değeri de hazırlanmış paketle aynı:
`5f8c94f444fc3ecb8239e2eb72a0d3b8a518d2c9b3ded89113004c40b88b01a5`.

Önceki devir notlarındaki “decoder VM'ye uygulanmadı” bilgisi artık tarihsel.
HR/RESP eşlenmemiş; SpO2/PLS doğrulanmamış aday alanlar. Klinik ingest kapalı.

## Canlı akış durmuş

Hub API'si ayrı viewer kimliği ve doğrulanan TLS CA ile 07:43:01, 07:43:04 ve
07:43:07 UTC'de sorgulandı; kimlik bilgileri veya ölçüm değerleri kaydedilmedi.

- Collector connected=true, mode=live; kuyruk sıfır, toplam accepted=1487 sabit.
- BED09 paket sayısı 828 sabit; son paket yaşı 1057 → 1060 → 1063 saniye.
  Son paket yaklaşık 07:25:24 UTC'de, yeni decoder başlangıcından önce gelmiş.
- Eski `.28` kaynağı 659 paketle stale; aktif hedef BED09 `.26`.
- Yeni decoder status=waiting; accepted/rejected/old_or_duplicate sayaçları sıfır.
  Dört alanın da değeri boş.
- İncelenen 07:20 sonrası hub journal'ında traceback/exception/error/failed
  metinleri bulunmadı. Bu, tüm olası arızaları dışlayan bir kontrol değildir.

Worker heartbeat'i ulaşıyor; yeni cihaz paketi ulaşmıyor. Bu kontrol tek başına
cihaz, multicast ağ yolu veya worker alıcısından hangisinin neden olduğunu
belirlemez. Worker VM'ye bu incelemede doğrudan giriş yapılmadı.

## Production web entegrasyonu eksik

VM ana checkout'unda `InfinityPreview.jsx` ve `infinityPreview.css` yok.
Çalışan web bundle'ında `infinityTest` veya `infinity-research` işaretleri yok.
Çalışan nginx yapılandırmasında `/infinity-research` yönlendirmesi yok.
8080 üzerindeki `/infinity-research/state`, JSON yerine 200 HTML (SPA fallback)
döndürüyor. Dolayısıyla güncel decoder kurulu olsa bile bu web uygulaması yeni
araştırma ekranını sunmuyor. Yerel nginx kaynağında da bu yönlendirme henüz yok.

## Dağıtımda korunması gereken sürüm farkı

VM ana checkout HEAD'i `873cbe2`; yerel HEAD `cfbba2a`.
VM commit'i yerel HEAD'in ilerisinde ve yeni ayarlar, RRT, yoğunluk, giriş ve
yönetim ekranı değişikliklerini içeriyor. Yereldeki Infinity geliştirmeleri ise
büyük ölçüde commit dışındaki dosyalarda. VM'yi topluca yerel eski checkout ile
değiştirmek uygun değil; Infinity değişiklikleri VM'deki güncel temel üzerine
birleştirilmeli. VM compose dosyası da yerelden farklı; saha ayarları korunmalı.

## Sonraki işler

1. Worker incelemesi aşağıda tamamlandı. BED09 yayınını kaynak tarafında ve
   VLAN203/sanal switch yolunda karşılaştırarak veri paketinin nerede kesildiğini belirle.
2. Production sürümünü temel alarak Infinity ekranını ve yetkilendirilmiş,
   sertifika doğrulamalı aynı-origin erişimini entegre et; sonra web'i dağıt.
3. Taze veri geldiğinde SpO2/PLS adaylarını eşzamanlı cihaz ekranıyla doğrula.
   HR/RESP için alan araştırması ayrıca sürüyor.

## Worker incelemesi — 07:49–07:54 UTC

Kullanıcının aynı SSH bilgileriyle devam etme talimatıyla `.74` incelendi.
Kullanıcı BED09'un açık ve hastane ağına bağlı olduğunu ayrıca teyit etti.

- Worker active/running, başlangıç 07:22:38 UTC, otomatik restart sayısı sıfır.
  Etkin kaynak `research-3d00e259297bf921`; payload aktarımı açık.
- Collector, stream, journal ve runner kaynakları yerel güncel dosyalarla aynı.
  Worker için decoder güncellemesi gerekmiyor; decoder hub üzerinde çalışıyor.
- Envanter yalnız `.26 → 224.0.2.26:2050`, arayüz `ens3=10.10.203.101/24`.
  Tek UDP2050 dinleyicisi, boş socket alım kuyruğu ve sıfır socket drop sayacı.
- Kernel ve Ethernet multicast üyelikleri mevcut. Gerekli grup sayısı 1,
  kapasite 20. NIC RX hata/drop/missed sayaçları sıfır.
- UFW inactive; nftables ip/ip6 filter tabloları boş. Reverse-path filter loose
  modda (2); hedefe rota ens3 üzerinden. NTP eşzamanlı.
- Outbox accepted=1487, queue=0. Worker journal'ında incelenen dönem için
  başlangıç/durdurma ve normal kapasite bilgileri dışında hata görülmedi.

35 saniyelik promiscuous olmayan, dosyaya payload kaydetmeyen başlık gözlemi:
07:49:45 UTC'de `10.10.203.250 → 224.0.0.1` IGMPv2 sorgusu;
07:49:55 UTC'de worker'dan `224.0.2.26` üyelik raporu. BED09 UDP paketi yok.
Capture kernel drop sayacı sıfır.

### Uygulanan sınırlı işlem

Yalnız araştırma worker servisi 07:51 UTC'de bir kez yeniden başlatıldı.
Konfigürasyon, IP/rota/firewall, veri tabanı ve anahtar değiştirilmedi.
Hub, web ve klinik servisler yeniden başlatılmadı.

40 saniyelik eşzamanlı başlık gözleminde IGMP leave, grup sorgusu, yeni üyelik
raporları ve querier sorgusu görüldü. BED09 UDP paketi yok; kernel drop sıfır.
35 saniye boyunca beş saniye arayla yedi outbox kontrolünde accepted=1487 ve
queue=0 kaldı. Yeniden başlatma veri akışını geri getirmedi; servis active bırakıldı.

### Son ayrım

BED09'a ens3 üzerinden üç ping'in ikisi yanıtlandı; bir yanıt alınamadı.
Komşu kaydı `00:30:e6:07:3f:f8`, REACHABLE. Bu, unicast erişim kanıtıdır;
multicast yayınının sürdüğünü kanıtlamaz.

Tüm arayüzlerde `.26` kaynaklı herhangi bir UDP portu için 15 saniyelik gözlemde
tcpdump 0 captured / 1 received by filter / 0 dropped bildirdi; incelenebilir UDP
başlığı çıkmadı. Son 25 saniyelik immediate-mode ens3 gözlemi de aynı sayıları
verdi. Filter sayacı sıfır olmadığı için bu iki test mutlak sıfır trafik kanıtı
olarak yorumlanmamalı. Worker kabul sayacı son kontrolde hâlâ 1487, kuyruk sıfır.

Kesinleşen: worker uygulaması ve üyeliği mevcut, yönetim/hub bağlantısı çalışıyor;
taze BED09 verisi araştırma hattına girmiyor. Kaynak yayınının durması ile fiziksel
switch/Nutanix multicast iletim sorunu henüz birbirinden ayrılmadı.

Sonraki salt okunur ağ kontrolü için mevcut topoloji notlarında DC1 Nexus A/B
çifti belirtiliyor. İlgili VLAN203 yolunda worker MAC `506b.8def.8378`, BED09
MAC `0030.e607.3ff8` ve grup `224.0.2.26` karşılaştırılmalı:

```text
show mac address-table address 506b.8def.8378
show mac address-table address 0030.e607.3ff8
show ip igmp snooping groups vlan 203
show ip igmp snooping mrouter vlan 203
```

Bu incelemede switch veya Nutanix'e bağlanılmadı. Kalıcı periyodik worker restart
veya multicast ayar değişikliği yapılmadı; böyle bir çözüm için kanıt yok.

## Multicast kayıp arızası ayrıştırıldı — 08:15–08:40 UTC

Anahtar tabanlı SSH ile `.72` ve `.74` üzerinde salt okunur inceleme. Yalnız worker'da
`tcpdump` için `cap_net_raw,cap_net_admin` yetkisi verildi (kullanıcı çalıştırdı; geri
alma `setcap -r /usr/bin/tcpdump`). Ağ, firewall, rota, servis ve veritabanı değişmedi.

### Elenen katmanlar

- **Saat.** Hub ve worker aynı saniyede. `LiveResearchView`'ün 3 sn eskime eşiği devre dışı değil.
- **IGMP versiyonu.** `force_igmp_version=0` ama `/proc/net/igmp` ens3 için `Querier=V2`;
  kernel querier'a uymuş, worker **IGMPv2** rapor gönderiyor. v3/v2 uyumsuzluğu yok.
- **Üyelik.** Grup `1A0200E0` (=224.0.2.26) ens3'te kayıtlı, `Reporter=1`,
  L2 filtresinde `01:00:5e:00:02:1a` var.
- **Rapor iletimi.** 75 sn gözlemde `10.10.203.250 > 224.0.0.1 igmp query v2` ve
  buna karşılık `10.10.203.101 > 224.0.2.26 igmp v2 report` kabloda görüldü.
- **Worker alıcısı.** Tek UDP2050 dinleyici, socket kuyruğu boş, kernel drop sıfır.

### Ağın çalıştığının kanıtı

Geçici üyeliklerle (yalnız IGMP sinyali; payload okunmadı, kaydedilmedi, çözülmedi)
13 Dräger grubu dinlendi. 30 saniyede kaynak→grup haritası:

| Kaynak | Grup | Paket/30 sn |
|---|---|---:|
| 10.10.203.23/24/25/27/28/29/31/32/33/37/38 | 224.0.2.\<aynı oktet\> | 148–149 |
| 10.10.203.34 | 224.0.2.34 | 209 |
| **10.10.203.26 (BED09)** | **—** | **0** |

Switch abone olunan her grubu anında teslim etti. Catalyst 3650 `2ACCSW-S2.3`,
snooping, Po46 yolu, Nexus ve Nutanix köprüsü bu ölçümle temize çıktı. Grup↔IP
eşlemesi 12 cihazda doğrulandı; artık tahmin değil.

### Kalan tek aday: kaynak

BED09 MAC `00:30:e6:07:3f:f8` 13 grubun hiçbirinde 30 saniyede tek paket üretmedi.
Aynı anda `10.10.203.26` ICMP'ye cevap verdi (3 denemede 2). Cihaz ağda, IP yığını
ayakta, parametre yayını yok. Switch MAC tablosu bu MAC'i `Gi3/0/46`'da gösteriyor
(daha önce `Gi3/0/47` sanılıyordu; o port `.28` monitörüne ait).

### Doğrulanmamış korelasyon

`.28` 21 Eylül'de sürekli abonelik altında sustu ve dönmedi; 22 Eylül'de abone
değilken 5 pps akıyor. `.26` 22 Eylül 07:22:38'de abonelik başladıktan 166 saniye
sonra sustu ve dönmedi. İki cihazda da susma bizim sürekli aboneliğimizle aynı
pencereye düşüyor. **Bu bir korelasyondur, mekanizma gösterilmedi.** IGMP üyeliği
pasif bir sinyaldir ve bir monitörü susturmamalıdır. Ayrıştırmak için şu an yayında
olan `.27` grubuna 8 dakikalık sürekli abonelik testi yapıldı; sonucu aşağıya yazılacak.

Alternatif ve en sade açıklama: monitör standby'a alındığında, hasta çıkışı
yapıldığında veya bakım ünitesi ataması değiştiğinde parametre yayını durur.
Bu, cihaz ekranından doğrulanmalıdır.

### Pratik sonuç

Proje BED09'u beklemek zorunda değil. 12 monitör kararlı akıyor; decoder doğrulaması
ve production entegrasyonunun uçtan uca testi başka bir yatakla sürdürülebilir.
Profil `bed09-26-partial-unverified-v3` kaynak `.26`'ya bağlıdır; başka cihaza
geçilirse guard'lar o kayıtla yeniden doğrulanmalı, eski eşleme taşınmamalıdır.

### Düzeltme — iki ayrı arıza, 08:54–09:03 UTC

Yukarıdaki "sürekli aboneliğimiz kaynağı susturuyor" korelasyonu **yanlıştı**.
Ölçüm iki bağımsız olayı ayırdı.

**Olay 1 — BED09 kaynağı sessiz.** 13 gruba taze üyelikle katıldığımız 30 saniyelik
gözlemde 12 monitör ~150'şer paket üretti; BED09 MAC `00:30:e6:07:3f:f8` sıfır üretti.
07:51'deki servis yeniden başlatması taze bir join üretmişti ve veri yine gelmedi.
Karşılaştırma: aynı yöntem `.27` üzerinde akışı anında geri getiriyor. Dolayısıyla
`.26` için sorun iletim değil, kaynağın yayın yapmaması. Cihaz ICMP'ye cevap veriyor;
ekran durumu (standby, hasta kaydı, bakım ünitesi ataması) kullanıcı tarafından
doğrulanmalı. Bu ölçüm cihazın neden sustuğunu söylemez, yalnız sustuğunu gösterir.

**Olay 2 — aralıklı iletim çökmesi.** `.27` grubunda 08:55:40 UTC civarında akış
30 saniyelik pencerelerde 150 → 128 → 32 → 1'e düştü ve düşük kaldı. 08:58'de
üyelik bırakılıp **taze join** yapıldığında ilk 30 saniyede 150 pakete döndü;
aynı üyelikle 95 saniye sonra hâlâ 150, bırak-ve-yeniden-katıl sonrası 149.

| Pencere | Koşul | Paket/30 sn |
|---|---|---:|
| A | üyelik yok | 1 |
| B | taze join, ilk 30 sn | 150 |
| C | aynı üyelik, ~95 sn sonra | 150 |
| D | bırak + taze join | 149 |

Yani çökme kaynağı durdurmuyor; **bizim portumuza iletim kesiliyor** ve yalnız taze
bir IGMP join geri getiriyor. Çekirdeğin querier sorgularına verdiği periyodik
cevaplar iletimi geri getirmiyor — bu, sorgu-cevap akışının kabloda görülmesine rağmen
böyle. Mekanizma (Catalyst snooping, Nexus, Nutanix AHV köprüsü) henüz belirlenmedi.

İlk çökme gözlemi iki eşzamanlı üyelik tutucusuyla yapıldığı için atıf yapılamazdı;
tek tutuculu 12 dakikalık temiz gözlem 09:03:07'de başlatıldı. Sıklık ondan okunacak.

Bu bulgu 21 Eylül'de onaylanan "watchdog + hedefli re-join" tasarımını artık
spekülasyon değil ölçüm olarak destekliyor: paket görülmeyince DROP+ADD ile üyelik
tazelenmeli, tazeleme sayacı raporlanmalı. Sayaç arızayı maskelemez, ağ ekibine
verilecek kanıt olur. Kalıcı çözüm yine ağ tarafındadır.

### Temiz koşu — prune arızası tek üyelikle üretildi, 09:03–09:12 UTC

Tek tutucu süreç, hiç leave yok, `holders=1` her pencerede doğrulandı.
`224.0.2.27`, 30 saniyelik pencerelerde paket sayısı:

```
join 09:03:07
w1..w6   149 149 149 150 150 149     09:03:38 → 09:06:08   (5 pps, normal)
w7         3                          09:06:38             (çöküş ~09:06:20)
w8..w17    1 1 1 1 1 1 1 1 1 1        09:07:08 → 09:11:38   (ölü)
```

Join'den çöküşe geçen süre üç ölçümde: `.26` 166 sn, `.27` (kirli koşu) ~89 sn,
`.27` (temiz koşu) 193 sn. Değişkenlik, join'in querier sorgu döngüsünün rastgele
bir noktasına düşmesiyle uyumlu. Sorgu worker'a ulaşıyor ve worker'ın IGMPv2 cevabı
kabloda görülüyor; buna rağmen iletim prune ediliyor. Dolayısıyla snooping yapan
cihaz üyelik sayacını solicited rapordan tazelemiyor. Hangi cihaz olduğu
(Catalyst 2ACCSW-S2.3, Nexus, Nutanix AHV köprüsü) belirlenmedi ve tahmin edilmemeli.

Ölü kalma süresi sınırsız; yalnız taze join geri getiriyor. DROP+ADD sonrası ilk
30 saniyelik pencere tam 150 paket verdi, yani tazeleme boşluğu ölçüm çözünürlüğünün
altında (<1 sn).

`.26` bu arızayla açıklanmaz: 07:51'de servis yeniden başlatıldı, taze join yapıldı,
veri gelmedi; aynı yöntem `.27`'de anında geri getiriyor. İki arıza ayrıdır.

**Karar (kullanıcı onayı):** collector hem önleyici (60 sn'de bir DROP+ADD) hem
tepkisel (10 sn sessizlikte acil tazeleme) davranacak; iki sayaç da heartbeat'te
raporlanacak. Sayaçlar arızayı maskelemez, ağ ekibine sürekli kanıt üretir.
Kalıcı çözüm ağ tarafındadır ve bu değişiklik onun yerine geçmez.

### Tazeleme mekanizması: boşluk şart — 09:20–09:47 UTC

Yukarıdaki "60 sn'de bir DROP+ADD" kararı **sahada çürütüldü ve değiştirildi**.

**Çürütülen:** aynı soket üzerinde boşluksuz `IP_DROP_MEMBERSHIP` + `IP_ADD_MEMBERSHIP`.
`224.0.2.27` üzerinde 60 sn aralıkla yedi tazeleme yapıldı; hiçbiri akışı geri getirmedi
ve çöküşü de engellemedi.

```
09:21:2x join
09:22:09 refresh 1   09:22:11 w2=149   09:22:41 w3=149
09:23:09 refresh 2   09:23:11 w4=149   09:23:41 w5=79    ← çöküş ~09:23:55
09:24:09 refresh 3   09:24:11 w6=1     09:24:41 w7=1
… refresh 4,5,6,7 — hepsi w=1
```

**Doğrulanan:** aynı soket, `DROP` → **2 saniye bekle** → `ADD`, 45 saniyede bir.

```
09:35:45 join (mode=dropadd, 45 sn aralık, 2 sn boşluk)
w1..w9 = 150 150 150 150 150 149 149 149 149
refresh 1..5 aralarında; join'den 275 sn sonra akış sağlam
```

Karşılaştırma tabanı: tazelemesiz temiz koşuda çöküş join'den 193 saniye sonra gelmişti.
Boşluklu tazeleme o eşiği sorunsuz geçti. İki denemede işe yarayan eski kurtarmaların da
ortak yanı üyeliğin birkaç saniye **yok** olmasıydı; soketin kimliği değil, **boşluk**
etkin maddedir.

Beklenmeyen ve olumlu bulgu: 2 saniyelik boşluk ölçülebilir paket kaybı üretmedi
(pencereler 149–150'de kaldı). Leave sonrası switch, group-specific query süresi boyunca
iletmeye devam ediyor olmalı.

**Koda geçirilen tasarım** (`infinity_collector.py`):

- `refresh_memberships()` ikiye ayrıldı: `leave_memberships()` ve `join_memberships()`.
  Tek çağrı bırakmak, boşluğun konulamayacağı bir yapı demekti.
- Tüm gruplar önce bırakılır, sonra hepsi yeniden katılır — grup başına leave/join
  çiftlemek, ölçümle çürütülen boşluksuz kalıbın aynısı olurdu.
- `collect()` bloklamaz: bırakma anında `rejoin_at` kurulur, döngü çalışmaya devam eder,
  süre dolunca katılım yapılır. Boşluk sırasında ikinci bir bırakma yapılmaz; yoksa
  boşluk sürekli sıfırlanır ve gruplara hiç dönülmez.
- Varsayılanlar: `refresh_interval=45` (ölçülen en hızlı çöküş 89 sn'nin altında),
  `rejoin_gap=2`, `silence_after=10`, `min_silence_gap=30`.
- Soketi kapatıp yeniden açmak da işe yarardı ama tercih edilmedi: collector 2050
  portunu `SO_REUSEADDR` olmadan tek başına tutuyor, yeniden bind yarış yaratır.

Birim testleri: `tests/test_infinity_transport.py` içinde 7 test — planlı tazeleme,
sessizlik watchdog'unun hız tavanı, paket gelirken tetiklenmemesi, başarısız rejoin'in
sayılıp collector'ı düşürmemesi, boşluk içinde ikinci bırakma yapılmaması, iki fazlı
sıralama, hub'ın yeni sayaç adlarını kabul edip bilinmeyeni reddetmesi.
Infinity paketi 101/101 geçiyor.

Bu hâlâ ağ arızasının üstünü örten bir çözümdür. `membership_refresh_*` sayaçları
arızanın sürdüğünün kanıtı olarak heartbeat'te taşınır; kalıcı düzeltme ağ tarafındadır.

### Düzeltme — "BED09 kaynağı sessiz" sonucu YANLIŞTI, 10:12–10:26 UTC

Bu belgede iki kez, artan bir kesinlikle "`.26` için sorun iletim değil, kaynağın yayın
yapmaması" ve "iki arıza ayrıdır" yazıldı. **İkisi de yanlıştı. Tek arıza var: prune.**

Tazeleme mekanizması worker'a dağıtıldıktan sonra `.26` kendiliğinden geri geldi.
10:26:08 UTC itibarıyla:

```
infinity-monitor-26  streaming  packets=4548  age=0.2 s
infinity-monitor-27  streaming  packets=165   age=0.3 s
infinity-monitor-28  streaming  packets=824   age=0.3 s
membership_refresh_scheduled=16  silence=1  failed=0
```

Araştırma hattı da doldu: `accepted=471`, `rejected=0`, `old_or_duplicate=0`;
`spo2_candidate` ve `pls_candidate` **candidate** ve taze (872 ms / 1083 ms);
`hr_candidate` ve `resp_candidate` `unmapped` kalıyor — doğru davranış.

**Yanlış sonucun kaynağı.** 13 gruplu taramada `.26`'ya ikinci bir soketten katılındı,
ama collector o üyeliği zaten tutuyordu. Linux multicast üyeliklerini arayüz başına
sayaçla tutar: zaten tutulan bir gruba ikinci kez katılmak **hiçbir IGMP raporu
üretmez**. Dolayısıyla o taramada `.26` taze join almadı. "BED09 MAC'i sıfır paket
üretti" bulgusu cihazın sustuğunun değil, portun hâlâ prune edilmiş olduğunun
kanıtıydı. Diğer on iki grup taze join aldığı için akıyordu; `.26` almadığı için akmadı.
Kontrol grubu sanılan şey aslında kontrol grubu değildi.

**07:51 restart'ının işe yaramaması da aynı şeyle açıklanıyor.** Servis yeniden
başlarken soket kapanır (leave) ve yeni süreç bir saniyeden kısa sürede yeniden katılır.
Bu, ölçümle çürütülen "boşluksuz" kalıbın ta kendisidir. Ölçülen eşik: 2 saniye çalışıyor,
~1 saniye çalışmıyor.

Ayrıca kullanıcı `.27`'de yatan hasta olmadığını bildirdi; o cihaz yine de 5 pps yayın
yapıyor. "Hasta yok veya standby → yayın durur" açıklaması da böylece elenmiştir.

Kayda geçsin: bu belgede daha önce "cihaz tarafı" denen şey ağ tarafıydı ve monitörlerde
bir sorun bulunmadı. Cihaza herhangi bir müdahale yapılmadı, gerekmedi.
