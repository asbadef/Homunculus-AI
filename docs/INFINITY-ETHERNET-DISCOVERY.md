# Infinity Kappa: mevcut Ethernet üzerinden doğrudan bağlantı

## Güncel saha sonucu — 2026-09-19

**Doğrudan Ethernet bağlantısında multicast UDP alımı doğrulandı; ölçüm çözümleme henüz
doğrulanmadı.** Kullanıcı test cihazını bilgisayara bağladığını ve aynı alt ağdan adres
verdiğini bildirdi. Sonrasında cihaz ekranında **standby** ve **Offline** gördüğünü belirtti.
Önceki tercihine göre test cihazına hasta bağlı değil. Sonradan paylaşılan Network Config
fotoğrafı, paketlerden bulunan **10.10.203.27 / 255.255.255.0** adresini doğruladı:
**Direct Net.**, **Host ID 27**, **Monitoring Unit ID 2**. Model/yazılım sürümü fotoğraflarda
görünmüyor. Ana ekran fotoğrafında sayısal değer veya dalga görünmüyor; standby'dan çıkış
ve test sinyali üretimi yalnızca bu görüntüden doğrulanamıyor. Fotoğraflar repoya alınmadı.

- Fiziksel arayüz: `LAN CABEL`, Realtek PCIe GbE, **Up / 10 Mbps**.
- PC: `10.10.203.1/24`; kullanıcı tarafından atanmış gateway `10.10.203.254` mevcut.
  Bu oturumda IP/gateway, cihaz ayarı veya ağ köprüsü değiştirilmedi.
- İlk 30 saniyelik, yalnızca doğrudan kablolu arayüzü kapsayan başlık gözleminde karşı
  kaynak **10.10.203.27** bulundu. Ardından mevcut CLI yalnızca bu kaynak için ikinci
  30 saniyelik yakalamada çalıştırıldı. Aşağıdaki sayılar **ikinci** yakalamaya aittir.

| Kaynak UDP portu | Hedef IP:UDP portu | Paket | Ortalama paket aralığı |
|---|---|---:|---:|
| 2564 | 224.0.2.27:2050 | 150 | 0.199967 s |
| 2000 | 224.127.2.254:2000 | 30 | 0.999758 s |
| 2100 | 224.127.2.253:2100 | 3 | 10.000672 s |
| 2150 | 224.127.2.255:2150 | 1 | tek paket; hesaplanamaz |

CLI sonucu `protocol_unverified`, `live_multicast_receipt_observed=true`,
`infinity_protocol_verified=false`, `clinical_ingest_enabled=false` oldu. Toplam 184
paket; bozuk başlık satırı, parçalanmış IP paketi ve geriye giden capture zamanı görülmedi.
Ham paket dosyası oluşturulmadı; uygulama yükü raporlanmadı ve cihaza uygulama komutu
gönderilmedi. 128 baytlık yakalama sınırı nedeniyle büyük paketler kasıtlı olarak kesildi;
bu, ağda paket kaybı tespiti değildir.

**Yorum sınırı:** yaklaşık 5 paket/s, 5 vital ölçüm/s anlamına gelmez. Port numarası ve
multicast adresi paket içeriğinin klinik anlamını kanıtlamaz. Standby/Offline göstergesi
varken veri alınması yalnızca fiziksel bağlantı ve ağ yayınının sürdüğünü gösterir;
Offline uyarısının kesin nedeni araştırılmadı. Üretici Gateway'i olmadan paket alımı
başardı, Gateway'in ölçüm çözümleme veya diğer işlevlerinin yerini alma henüz başarılmadı.

Fotoğraflar sonrasında aynı arayüz ve kaynak filtresiyle yapılan ek 30 saniyelik gözlemde
yeniden **184 paket** alındı: UDP 2050 için 150, 2000 için 29, 2100 için 3 ve 2150 için 2.
2050 akışının ortalama paket aralığı 0.199959 saniyeydi. Protokol hâlâ doğrulanmadı;
bu tekrar gözlemi, cihaz modunun değiştiğine veya ölçüm üretildiğine kanıt değildir.

Üreticinin [Gateway kurulum kılavuzu 3703521, s.16](https://www.draeger.com/Content/Documents/Products/infinity-gateway-suite-installation-and-setup-guide-sw-vf9n-ifu-3703521-en.pdf)
UDP 2050'yi Infinity PDS, 2000'i Infinity AGS, 2100'ü Infinity Time Service, 2150'yi
Infinity Name Service olarak listeler. Gözlenen hedef portları bu servis listesiyle
eşleşir; bu belge Kappa paketlerinin alan düzenini veya sayısal değerlerini doğrulamaz.
[Protocol Handbook 3703522, s.27](https://www.draeger.com/Content/Documents/Products/infinity-gateway-suite-protocol-handbook-sw-vf9n-ifu-3703522-en.pdf)
WinAccess API'nin veriyi Gateway sunucusundan aldığını açıklar; bunu doğrudan Kappa PDS
çözücüsü olarak kullanabileceğimiz sonucuna varılmadı.

Kullanıcı menüde Demo/Simulation alanı görmediğini bildirdi. Bu, özelliğin cihazda
kesinlikle bulunmadığını göstermez; sürüme uygun belge olmadan servis menüsü veya ağ
ayarlarını değiştirme adımı verilmedi. Bilinen bir test sinyali henüz doğrulanmadı.

Kullanıcının cihazın artık ölçüm gösterdiğini bildirmesinden sonra yapılan 30 saniyelik
başlık gözleminde **185 paket** alındı: UDP 2050 için 150, 2000 için 30, 2100 için 3,
2150 için 2. UDP 2050 akışında toplam tel üzerindeki boyut önceki 150 paketlik
gözlemdeki 66.540 bayttan **123.840 bayta** çıktı; ortalama paket aralığı 0.199961
saniyeydi. Paket boyutu değişikliği gözlendi; bunun hangi ölçüm veya dalga alanından
kaynaklandığı bilinmiyor. İçerik çözülmedi, ham kayıt veya kişisel ölçüm kaydedilmedi.
Bu aşama kontrollü simülatör doğrulaması sayılmaz; `protocol_unverified` durumu sürüyor.

Kullanıcı sonradan cihaz modelini **Dräger Infinity Kappa** olarak teyit etti; yazılım
sürümü hâlâ teyit edilmedi. Sonraki ekran fotoğrafı sayısal ölçümlerin görünür olduğunu
doğruladı. Fotoğraf veya kişisel değerler bu belgeye alınmadı. Eşleme gereksinimi:
**PLS ile ECG HR ayrı parametreler olarak tutulmalı; `***` sıfır veya geçerli ölçüm
olarak yorumlanmamalı.**

Ardından, aynı kaynağın yalnızca UDP 2050 akışı 30 saniye boyunca tam paketlerle
**bellekte** yapısal olarak incelendi. Tek seferlik inceleme CLI'nin 128 baytlık başlık
yakalama varsayılanını değiştirmedi; dosya oluşturulmadı, yük baytları çıktıya alınmadı.
622 bayt UDP yükü taşıyan 121 paket ve 1.430 bayt yük taşıyan 30 paket görüldü. Her boyut
grubunda ilk 6 bayt sabitti; sırasıyla 68 ve 60 bayt konumu değişiyordu. Boyuta göre
gruplama mesaj türü veya alan anlamı doğrulaması değildir; bu sonuçtan şifreleme,
ölçüm değeri, birim, cihaz zamanı veya geçerlilik kodu çıkarılmadı.

Sonraki adım: yazılım sürümünü teyit etmek ve üretici protokol belgesi veya kontrollü,
hasta bilgisi içermeyen test verisiyle sayısal alanları, ölçekleri ve geçerlilik kodlarını
doğrulamak. Ağ erişimi sağlandı; ölçüm çözücüsü için protokol belirsizliği sürüyor.

## Önceki durum — 2026-09-18

**Keşif aracı hazır; doğrudan vital okuyan Infinity sürücüsü henüz yok.** Hedef, mevcut
13 Kappa VF9.1-C monitörünün sayısal ölçümlerini ek Gateway/seri donanım olmadan almak.
Bu araç ağ görünürlüğünü araştırır; alınan paketin Infinity ölçümü olduğunu iddia etmez.

Bu çalışma sırasında doğrulananlar:

- Geliştirme bilgisayarının etkin bağlantısı hastanenin `10.10.218.x/24` Wi-Fi ağıdır.
  Önceki saha envanterindeki monitör ağı `10.10.203.0/24` olarak kayıtlıdır.
- Wireshark 4.6.2 ve dumpcap kurulu, yerel ağ kartları listelenebiliyor.
- Önceki saha kaydındaki bir başucu IP'si için 15 saniyelik pasif gözlem tamamlandı:
  **0 paket**. Ham paket dosyası oluşturulmadı; cihaz komutu gönderilmedi.
- Monitörün o anda aktif olduğu, switch/vSwitch aynalama yapılandırması ve Homunculus
  VM'inin multicast erişimi doğrulanamadı. Bu sıfır sonuç uyumsuzluk kanıtı değildir.
- Bilinen Homunculus VM'inin SSH portuna (`172.100.101.72:22`) yapılan 5 saniyelik
  bağlantı kontrolü zaman aşımına uğradı. VM'de oturum açılamadı; bunun sunucunun
  kapalı olduğu anlamına geldiği varsayılmıyor. Erişim yolu/firewall henüz doğrulanmadı.
- Kappa VF9.1-C'nin yerel Ethernet paket biçimini doğrulayan belge veya test kaydı henüz yok.

Mevcut HL7/ADT/PDQ alıcıları ayrı işlevlerdir ve bu keşif aracı onları değiştirmez.
Önceki araştırmanın “seri bağlantı tek yol” sonucu, mevcut Ethernet seçeneğinin teknik
olarak elendiği anlamına gelmez.

## Kanıtın sınırları

[Cisco'nun Infinity ağ kılavuzu](https://www.cisco.com/c/en/us/products/collateral/wireless/draeger-patient-monitoring-cat-wireless-dg.html)
başucu cihazlarının sayısal değer ve dalga verilerini multicast akışlarıyla taşıdığını açıklar.
Bu aile düzeyinde ağ bilgisidir; sahadaki Kappa VF9.1-C için paket alanlarını tanımlamaz.
[Cisco–Dräger açıklaması](https://blogs.cisco.com/industries/cisco-and-drager-network-reliability-in-healthcare)
Gateway'in üretici protokolü ile HL7 arasında dönüşüm yaptığını belirtir.

[Gateway Protocol Handbook 3703522](https://www.draeger.com/Content/Documents/Products/infinity-gateway-suite-protocol-handbook-sw-vf9n-ifu-3703522-en.pdf)
Gateway dış arayüzlerini anlatır; yerel Kappa Ethernet protokol belgesi yerine kabul edilmez.
Ping, MLLP portunun açık olması veya yalnızca multicast paket alınması ölçüm çözümleme
başarısı sayılmaz. Paket aralığı, ölçümün yenilenme aralığı değildir.

## Kullanım

Python ortamında Homunculus paketi kurulu olmalı (`homunculus-engine` geliştirme ortamı).
Capture host üzerinde Wireshark'ın `tshark` ve `dumpcap` araçları ve ilgili ağ kartında
yakalama yetkisi gerekir. PATH'te yoksa Windows'un standart Wireshark dizini aranır;
başka kurulumlar için `--tshark` ve `--dumpcap` tam yolları verilebilir.

Önce **hastane içindeki capture host** üzerinde `dumpcap -D` ile arayüzü belirle.
Arayüz numarası bilgisayarlar/oturumlar arasında değişebilir. Yerel Linux arayüz adı veya
Windows NPF kimliği kullanılabilir. VM/NIC'in monitör VLAN'ını ya da mevcut switch'in
ayna trafiğini gerçekten gördüğünü ağ ekibinin yapılandırmasından doğrula. Sanal ağ
erişimi/aynalama kurulması fiziksel bir Gateway gerektirmez; bu araç o ayarları değiştirmez.

`homunculus-engine` dizininde, etkin geliştirme ortamından:

```powershell
$env:PYTHONPATH = 'src'
python scripts/discover_infinity.py --interface '<dumpcap -D kimliği>' --device '<doğrulanmış Kappa IPv4>' --duration 30
```

Linux için:

```bash
PYTHONPATH=src python scripts/discover_infinity.py --interface eth0 --device <Kappa-IPv4> --duration 30
```

`--device` bir ile 13 farklı kaynak IP için tekrarlanabilir. İlk deneme tek aktif cihazla
yapılır. Varsayılan süre 30 saniye, üst sınır 300 saniye; varsayılan paket sınırı 20.000,
üst sınır 100.000'dir. Tüm alt ağı yakalayan varsayılan filtre yoktur.

Önceden elde edilmiş, hastane içinde kalan pcap/pcapng için:

```bash
PYTHONPATH=src python scripts/discover_infinity.py --read /secure-hospital-storage/test.pcapng --device <Kappa-IPv4>
```

Offline modda paket sınırı dosyadaki **tüm giriş paketlerine** uygulanır; sadece seçili
cihaza ait satırları saymaz. Büyük dosyadaki ilgili trafik sınırın sonrasında kalabilir.
Offline sonuç bugünkü ağ erişimini doğrulamaz. Dosyayı repoya taşımayın.

Canlı yakalamada `dumpcap → stdout pipe → tshark → başlık özeti` kullanılır. `tshark`
canlı yakalama modunda başlatılmaz; ham yakalama için geçici dosya oluşturulmaz.
İlk 128 bayt yalnızca bellekte işlenir; bu pencere yükün bir bölümünü de içerebilir,
fakat yük alanları çıktıya alınmaz. Araç ağ adı çözümlemesi, multicast üyelik isteği,
cihaz sorgusu veya klinik API çağrısı yapmaz. IP/port özetleri de hastane içinde tutulmalıdır.
IPv4 Ethernet ve tek VLAN etiketi hedeflenir; parçalanmış IP paketleri sayılıp analizden
çıkarılır. Paket kaybı ve ölçüm tekrarları bu araçla doğrulanmaz.

## Hasta bağlı olmayan Kappa ile doğrudan bilgisayar testi

Bu yol hastane switch'i, VLAN geçişi ve VM erişimini denemeden çıkarır. Fiziksel düzen:
**hasta bağlı olmayan Kappa → X14 Infinity Network portu → Ethernet kablosu → PC'nin
fiziksel Ethernet portu**. X14, [Dräger VF9 kılavuzunun 3-8 bölümünde](https://www.draeger.com/Content/Documents/Products/infinity-delta-series-vf9-ifu-ms31168-en.pdf)
ağ portu olarak tanımlıdır; bu bağlantı hazır HL7 çıkışı anlamına gelmez. Cihazın hastane
ağına bağlı X14 kablosunu çıkarmak merkez bağlantısını keser; bu test yalnızca hasta
bağlı olmayan, test için ayrılmış cihaz içindir.

Uygulama hazırlığında geliştirici bilgisayarında fiziksel adaptör **LAN CABEL / Realtek
PCIe GbE Family Controller** olarak doğrulandı. **Ethernet** adlı adaptör ise Fortinet
sanal adaptörüdür. Fiziksel adaptör `Down`, link hızı `0 Mbps` durumundaydı. Bu nedenle
doğrudan bağlantı yakalaması başlatılmadı; test cihazının IP/model/sürüm doğrulaması bekliyor.
Bu bulgu önceki Wi-Fi üzerinden yapılan 15 saniyelik gözlemden ayrı tutulmalıdır.

1. Test cihazının ekrandaki modelini, yazılım sürümünü ve IP adresini kaydet. Eski saha
   kaydındaki IP'yi bu cihazın adresi kabul etme. Cihazın mevcut ağ ayarlarını değiştirme.
2. Kabloyu tak ve link ışığını / Windows arayüz durumunu kontrol et. Standart kabloyla
   link oluşmazsa kabloyu ve adaptörün Auto-MDI-X desteğini kontrol et; çapraz kablo
   gerekebilir. [Kablo ve bağlantı açıklaması](https://www.intel.com/content/www/us/en/support/articles/000007187/ethernet-products.html).
   Bu bilgisayardaki Auto-MDI-X desteği henüz doğrulanmadı.
3. Fiziksel link `Up` olduktan sonra doğru kaynak IP ile 30 saniye pasif gözlem yap.
   PC'nin aynı IPv4 alt ağında olması bu ilk paket yakalaması için şart değildir.
4. Hiç trafik görülmezse sonuç "uyumsuz" değildir: cihaz IP'si, link, cihazın çalışma
   durumu ve izole çalışırken veri yayınlayıp yayınlamadığı ayrı ayrı incelenir. Monitörün
   kendiliğinden sayısal veri yayınladığı veya merkez gerektirmediği varsayılmaz.

Aşağıdaki PowerShell komutları mevcut geliştirme bilgisayarı içindir. `homunculus-engine`
dizininde çalıştırılır; IP, cihaz ekranından okunur. Birden fazla aynı model adaptör veya
link yoksa yakalama başlamaz. Arayüz numarası yerine kart kimliği kullanılır:

```powershell
$testNics = @([System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
    Where-Object { $_.Description -eq 'Realtek PCIe GbE Family Controller' })
if ($testNics.Count -ne 1) { throw 'Fiziksel test adaptoru tekil olarak bulunamadi.' }
$testNic = $testNics[0]
if ($testNic.OperationalStatus -ne 'Up') { throw 'Ethernet linki yok; kabloyu ve cihazi kontrol edin.' }
$testMonitorIp = Read-Host 'Test Kappa ekranindaki IPv4 adresi'
$captureInterface = '\Device\NPF_' + $testNic.Id
$env:PYTHONPATH = 'src'
& .venv/Scripts/python.exe scripts/discover_infinity.py --interface $captureInterface --device $testMonitorIp --duration 30
```

Sonraki aşamada IP iletişimi gerektiği kanıtlanırsa önce PC adaptörünün mevcut ayarları
kaydedilir; yalnızca bu adaptöre cihazla aynı alt ağda farklı, çakışmayan bir IP atanır.
İzole bağlantıda ağ geçidi/DNS eklenmez. Wi-Fi–Ethernet köprüsü veya internet paylaşımı
açılmaz. Bu ayar değişikliği ilk gözlem için yapılmaz; test sonrasında önceki ayarlar
geri yüklenir.

Başarı sırası: **link → cihazdan paket → doğrulanmış protokol → doğrulanmış ölçüm**.
Sayısal değer karşılaştırması için biyomedikal simülatör veya ağdan veri verdiği doğrulanmış
demo modu gerekir; hasta bağlı olmayan cihazın kendiliğinden nabız/SpO₂ üretmesi beklenmez.
Mevcut araç yalnızca başlıkları özetler. Decoder geliştirmek için ayrıca hasta verisi
içermeyen test paketleri ve alanlarının doğrulanması gerekir. Klinik kayıt veya ölçüm modeli
bu test için oluşturulmaz.

## Sonucu okuma ve sonraki aşama

| Sonuç | Anlamı ve yapılacak iş |
|---|---|
| `capture_error` / çıkış 2 | Araç çalışmadı; araç yolu, girdi, arayüz veya capture yetkisini düzelt. Ağ hakkında sonuç çıkarma. |
| `interrupted` / çıkış 130 | Kullanıcı durdurdu; tamamlanmış gözlem sayılmaz. |
| `network_unverified` | İzin verilen kaynaklardan kullanılabilir multicast UDP görülmedi. Aktif cihazı, doğru arayüzü, VLAN ve aynalama yolunu doğrula. |
| `protocol_unverified` | Seçili IP'den multicast UDP görüldü; Infinity olduğuna veya vital çözülebildiğine kanıt değildir. Paket biçimi doğrulamasına geç. |

Çıkış 0 yalnızca analizin tamamlandığını söyler. **Hiçbir sonuç klinik ingestion açmaz.**
Kaynak/hedef IP, taşıma protokolü, port, paket sayısı, gözlenen süre, ortalama/en uzun paket
aralığı, kesilmiş paket ve geriye giden capture zamanı sayıları raporlanır. En fazla 1024
akış tutulur; reddedilen/veri sınırını aşan satırların içerikleri yazdırılmaz.

Doğrudan sürücü için gereken sıra:

1. Ağ ekibinin mevcut switch/vSwitch üzerinden doğruladığı yol ve bir aktif test monitöründen
   görülen trafik. VM'in yalnızca yönetim IP'sine erişmek yeterli değildir.
2. Kappa VF9.1-C ağ protokolü belgesi/SDK veya hasta bağlı olmayan cihazdan çevrimdışı test
   verisiyle doğrulanmış paket alanları. Şifreli/kimliği doğrulanmış bağlantı gerekiyorsa
   üreticinin sağladığı erişim gerekir; güvenlik modu düşürülmez.
3. Nabız, SpO₂ ve solunum sayısında kod, değer, birim, geçerlilik ve cihaz zamanını ekranla
   karşılaştırma. Eksik/bilinmeyen değer üretmek yerine reddedilir. Cihaz kimliği hasta kimliği
   yerine geçirilmez; hasta/yatak eşleşmesi doğrulanmamış ölçüm motora gönderilmez.
4. Doğrulanan decoder mevcut `Observation` modeline bağlanır; mevcut tampon ve uplink
   kullanılır. Bağlantı kesilmesi, eski veri, tekrarlar, zaman düzeltmesi ve hasta/yatak
   değişimi test edilir; ardından 13 akışın ayrımı doğrulanır.

Bu dört adımın son üçü ağ/paket kanıtı olmadan tamamlanmış sayılmaz. Bu aşamada üretim
decoder'ı, tahmini kod eşlemesi veya sahte klinik veri akışı eklenmemiştir. Dalga ve alarm
aktarımı, cihaz kontrolü ve genel hastane HL7 yönlendirme motoru kapsam dışındadır.

## İsteğe bağlı tam paket kaydı

Başlık keşfi ile tam paket kaydı ayrı işlemlerdir. Kullanıcı 2026-09-19'da ECG denemesi
öncesinde bütün cihaz paketlerinin daha sonra incelenmek üzere kaydedilmesini açıkça
istedi. Bu durumda `dumpcap` ile PCAPNG kaydı alınır; keşif CLI'sinin başlıkla sınırlı
varsayılanı değiştirilmez.

- Önce seçili IP'den gelen Ethernet başlığından cihaz MAC adresini doğrula.
- Fiziksel test arayüzünde cihaz MAC adresine ait iki yönlü trafiği ve cihaz IP'sine ait
  ARP trafiğini filtrele; başka arayüzlerden veya tüm hastane ağından kayıt alma.
- `-s 0` ile snaplen kesmesini kaldır; `-a duration:300 -a filesize:262144` ile ilk
  kaydı 5 dakika veya 256 MiB ile sınırla. Bu sınırlar yakalama kaybını önleme garantisi
  değildir; bitişte yakalama istatistikleri ayrıca kontrol edilir.
- Ham dosya kişisel ölçüm/kimlik içerebilir. **Repo dışında** yerel bir klasöre kaydet;
  `.gitignore` olması dosyanın repo içinde tutulmasına izin vermez. Bu oturumdaki kök
  klasör `C:\Users\User\Desktop\Homunculus-Captures` olarak seçildi.
- Arayüz, filtre, UTC başlangıç zamanı ve sınırları ayrı bir oturum dosyasında tut.
  Kullanıcının ECG başlangıç bildirimi gelirse bildirim zamanını işaretle; bu zamanın
  cihaz ölçüm saatiyle veya gerçek başlangıç anıyla eşit olduğu varsayılmaz.
- Kayıt kapandıktan sonra paket sayısı, kesilmiş paketler, bildirilen yakalama kayıpları
  ve SHA-256 özeti kontrol edilir. Ham dosya korunur; analiz çıktıları ayrı dosyalara
  yazılır. Dosyalar harici servislere yüklenmez veya repoya eklenmez.

Tam paket kaydı, protokolün ya da ECG/sayısal alanların doğrulandığı anlamına gelmez.

## Çevrimdışı aday alan incelemesi

`scripts/analyze_infinity_capture.py` yalnızca mevcut dosyayı okur; canlı arayüz açmaz.
Bu bir üretim Infinity sürücüsü değildir. Ekranla yapılan geriye dönük karşılaştırmadan
çıkan alan adları hipotezdir; aynı veriyle bulunan eşleşme bağımsız doğrulama sayılmaz.

Araştırma profili `version: 1`, `payload_length`, `allowed_capture_sha256`, `guards`
ve `fields` içerir. Her alan için `name`, `offset`, `width` (1/2/4 bayt) ve `byteorder`
(`big`/`little`) belirtilir. Her yapı kontrolü `offset` ve `hex` içerir. Ofsetler UDP
yükünün başından sıfır tabanlıdır. Profil ve gerçek veriden türeyen çıktılar repo dışında
tutulur. SHA-256 listesi, mevcut hipotezin farkında olmadan yeni bir kayda uygulanmasını
önler; eşleşen dosya özeti protokolün doğru çözüldüğüne kanıt değildir.

```powershell
$env:PYTHONPATH = 'src'
python scripts/analyze_infinity_capture.py --read '<repo dışındaki kayıt.pcapng>' --device '<cihaz IPv4>' --profile '<repo dışındaki hipotez.json>' --output '<repo dışındaki yeni rapor.json>' --include-series
```

- Tam dosya özeti başta ve sonda doğrulanır. Çalışma sırasında değişen veya izinli
  SHA-256 listesinde olmayan dosyadan rapor üretilmez.
- Kaynaklar ve akışlar ayrı tutulur. Kesilmiş, parçalanmış veya bozuk paketler aday
  çıkarımına alınmaz; boyut/yapı kontrolü tutmazsa eşleme uygulanmaz.
- `--include-series` yalnızca yerel rapora ham aday tamsayı serilerini ekler. Konsolda
  kişisel değerler, yük içeriği veya profil yazdırılmaz. Rapor mevcut dosyanın üzerine
  yazılmaz ve Git reposu içindeki çıktı yolları reddedilir.
- `1`/`4` gibi değerler otomatik olarak eksik ölçüm veya gerçek sayı ilan edilmez.
  Geçerlilik, birim, ölçek ve cihaz zamanı çözülmediği için bütün adayların klinik
  geçerliliği **bilinmiyor** kalır; `Observation`, tampon veya motora aktarım yoktur.
- Rapor, aynı UDP yükünün tekrarını ve yakalama saatinin geriye gitmesini sayar.
  Bunlar tekrar ölçüm/eski klinik veri tespiti değildir. Rapor zamanları PC yakalama
  saatidir; cihazın ölçüm saati olarak gösterilmez.
- Girdi 256 MiB, seçili başlık satırları 20.000, satır uzunluğu 140.000 bayt, akışlar
  64, şekiller 128 ve şekil belleği 2 MiB ile sınırlıdır. Okuyucu zaman aşımında
  durdurulur; sınır aşılırsa kısmi sonucu başarı gibi kaydetmek yerine hata verilir.

19 Eylül araştırmasında iki ham kayıt değişmeden korunarak her birindeki 300 uzun
paket, dışarıda tutulan aynı profilin yapısal kontrollerini geçti. HR, PLS, SpO₂ ve
RESP için aday konumlar tekrar çıkarılabildi. Alanların parametre kimlikleri, geçerlilik
kodları, ölçekleri ve cihaz zamanı doğrulanmadı. Sabit ofsetlerin diğer sürümlere,
parametre düzenlerine veya hasta/yatak değişimine taşınabileceği varsayılmıyor.

## Homunculus deneysel test ekranı

Web dashboard'da `?infinityTest=1` ayrı test görünümünü açar. Normal canlı hasta ekranı
ve klinik pipeline'a bağlı değildir. Dört alan **ham sayı/adayı** olarak gösterilir;
geçerlilik, birim ve ölçek doğrulanmamıştır. Hasta eşleştirmesi yapılmaz. Klinik alarm,
puan veya FHIR/Observation üretmez. Özel görünümün açıkça seçilmesi gerekir;
`?live=1` normal canlı uygulama önceliğini korur.

`homunculus-engine` dizininde, mevcut kaydı oynatmak için:

```powershell
$env:PYTHONPATH = 'src'
python scripts/serve_infinity_preview.py --replay '<repo dışındaki kayıt.pcapng>' --device '<cihaz IPv4>' --profile '<repo dışındaki hipotez.json>'
```

Başka bir terminalde `dashboard` dizininden:

```powershell
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Adres: `http://127.0.0.1:5173/?infinityTest=1`. Kayıt oynatımı ilk durum isteğinde
başlar, özgün paket aralıklarını izler ve iki saniyelik boşlukla tekrar eder. Kaydedilmiş
veri her zaman **KAYITTAN OYNATIM — CANLI ÖLÇÜM DEĞİL** etiketiyle gösterilir. Ekrandaki
zaman PC'nin kayıt zamanıdır; şu anki veya cihaz kaynaklı ölçüm zamanı değildir.

Doğrulanmamış canlı paket denemesi ayrı ve açık bir başlatma seçeneğidir:

```powershell
$env:PYTHONPATH = 'src'
python scripts/serve_infinity_preview.py --interface '<fiziksel dumpcap arayüz kimliği>' --device '<cihaz IPv4>' --profile '<repo dışındaki hipotez.json>' --duration 300
```

- Aynı portta kayıt oynatma servisi açıksa önce normal biçimde durdurulur. Canlı seçenek,
  tek kaynak IP ve UDP 2050 için en fazla 300 saniye/20.000 paket alır; baytlar yalnızca
  pipe/bellekte işlenir. Yeni ham dosya veya klinik kayıt yazılmaz; cihaz komutu ve
  multicast üyelik isteği gönderilmez.
- Profilin dosya özeti listesi **yalnızca çevrimdışı kaydı** doğrular. Canlı modda bu
  koruma uygulanamaz; kaynak, boyut ve yapı kontrolleri kullanılır. Bu açıkça farklı bir
  deneysel yoldur; protokol doğruluğu/klinik geçerlilik bayrakları hep `false` kalır.
- Alıcı yalnızca `127.0.0.1:8765` üzerinde dinler. Host denetimi ve sınırlı yerel origin
  listesi kullanır; yanıtlar `Cache-Control: no-store` taşır. Kamuya yayınlanmış dashboard
  bu yerel servis için izinli origin değildir. Veri localStorage'a veya hasta deposuna
  kaydedilmez.
- Sayılar, son kabul edilen paketten üç saniye sonra gizlenir. Aynı yükün tekrarı ve
  geriye/eşit giden yakalama zamanı güncelliği yenilemez. Geçersiz yapı, akış sonu veya
  kaynak hatasında sayılar hemen temizlenir. Tarayıcı istekleri takılırsa istemci kendi
  sayacıyla da değerleri gizler.
- Bu kontroller **paket gelişinin güncelliğini** değerlendirir. Paketin taşıdığı sayının
  cihazda eski/geçersiz ölçüm olup olmadığını çözmez; küçük durum kodları da ham aday
  olarak gelebilir. Dolayısıyla ekran klinik monitör yerine kullanılamaz.

Yerel doğrulamada kayıt oynatımı ve gerçek tshark'a bağlı sentetik canlı pipe denendi.
Gerçek cihaz ölçümü durdurulduktan sonra bu ekran için yeni canlı yakalama yapılmadı.

## Yerel doğrulama

19 Eylül 2026: deneysel önizleme, çevrimdışı araştırma, keşif ve mevcut HL7/MLLP/bridge/ADT
testlerinden **95 test**, dashboard'un tüm testlerinden **281 test geçti**. Önizleme testleri
güncellik kaybında temizleme, tekrar/sıra kontrolü, yerel origin/host sınırı ve sentetik canlı
pipe temizliğini de kapsar. Araştırma testleri yapı/profil sınırlarını, hash uyumsuzluğu ve dosya
değişimini, zaman aşımında süreç temizliğini, sentetik PCAP/PCAPNG ve VLAN okumayı,
13 kaynağın ayrımını ve hassas çıktı sınırlarını kapsar. Gerçek iki kayıtta da 300'er
uzun paket aynı dış profille yeniden işlendi; bu kontrol klinik doğrulama değildir.

18 Eylül 2026: keşif, HL7 parser, MLLP, bridge ve bridge ADT testlerinden **64 test geçti**.
Keşif testleri gerçek tshark 4.6.2 ile sentetik Ethernet/VLAN paketlerini hem pcap hem
pcapng dosyalarından ve yalnızca bellekteki bir pipe üzerinden işler. Gerçek Infinity
ölçüm doğruluğu, klinik bağlantı veya 13 canlı cihaz kapasitesi bu testlerle kanıtlanmaz.

```bash
python -m pytest tests/test_infinity_discovery.py tests/test_gateway_hl7.py tests/test_edge_mllp.py tests/test_edge_bridge.py tests/test_edge_bridge_adt.py -q
```

Wireshark bulunmayan ortamlarda gerçek tshark entegrasyon testleri atlanır; saf özetleme,
kaynak ayrımı, bozuk girdi, süreç temizleme ve sınır testleri çalışır.
