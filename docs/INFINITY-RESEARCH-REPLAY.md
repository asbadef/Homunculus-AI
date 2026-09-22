# Infinity araştırma ekranı — 21 Eylül 2026

Mevcut PCAP'taki HR, SpO₂, PLS ve RESP aday alanları artık Homunculus'un
`?infinityTest=1` ekranına bağlıdır. Bu sürüm **yerel kayıt oynatımıdır**.
Ubuntu worker ve Homunculus hub üzerindeki çalışan metadata servisleri değiştirilmedi.
Canlı sayısal aktarım, klinik `/ingest`, hasta eşleştirmesi ve ECG dalga çözümü etkin değildir.

## Doğrulanan davranış

- RAW IPv4 PCAP, kaynak/grup/port, SHA-256 ve her aday alanın önündeki opak
  bayt kontrolleri doğrulanır. Kontrol baytlarının anlamı protokol belgesi gibi sunulmaz.
- İlgili 300 paketlik kayıtta 898 baytlık 60 paket HR/SpO₂/RESP'yi, 1430 baytlık
  60 paket PLS'yi günceller. 676 baytlık 180 paket sayısal alan güncellemez.
- Her alan ayrı eskir; üç saniye sonra gizlenir. Yeni HR paketi PLS'yi tazelemez.
  Tarayıcı da istekler takılsa bile alanları yerel saatiyle gizler.
- Kayıt özgün paket aralıklarıyla bir kez oynar. Sonunda bütün sayılar gizlenir;
  tekrar oynatmak için düğme gerekir. PCAP zamanına video hizalama ofseti eklenmez.
- Görüntüleme anahtarı ayrı, yalnız sekme belleğinde; API aynı origin üzerinden,
  yanıtlar `no-store`. Ham paket/veri dosyası sunan HTTP endpoint yoktur.
- API/decoder araştırma modu dışında kullanılmaz. Birim, ölçek, sentinel,
  cihaz ölçüm zamanı ve geçerlilik bitleri henüz doğrulanmış değildir.

Referans PCAP SHA-256:
`d81a0637006b070f9e2ce3e88435a61d2726a30a7737ec8f6cfe2fdeb14360d4`.
Bu profil yalnız bu kayda bağlıdır; yeni canlı kaydın hash'ini otomatik kabul etmez.
Önceki videoyla aynı veri üzerinde bulunan eşleşme, bağımsız canlı doğrulama sayılmaz.

## Bu bilgisayarda açma

Bu çalışma sırasında başlatılan yerel ekran:
`http://127.0.0.1:5174/?infinityTest=1`.
Görüntüleme anahtarını **Windows PowerShell** ile panoya al; sohbete yazdırma:

```powershell
Get-Content -Raw -LiteralPath "$env:TEMP\HomunculusDiagnostics\infinity-research-20260921\viewer-token.txt" | Set-Clipboard
```

Ekrana anahtarı yapıştır ve `Kaydı aç` seç. Kayıt daha önce tamamlandıysa
`Kaydı baştan oynat` düğmesine bas. Bu anahtar hub'ın mevcut viewer anahtarı değildir.

Yerel servisler kapatıldıysa, iki ayrı Windows PowerShell penceresinde yeniden başlat:

```powershell
Set-Location 'C:\Users\User\Desktop\Project\Homunculus AI'
$env:PYTHONPATH = (Resolve-Path '.\homunculus-engine\src').Path
& '.\homunculus-engine\.venv\Scripts\python.exe' '.\homunculus-engine\scripts\serve_infinity_replay.py' --replay 'C:\Users\User\Desktop\Homunculus-Captures\infinity-vm-28-20260921-13e05dd7-video\infinity-ipv4.pcap' --profile 'C:\Users\User\Desktop\Homunculus-Captures\infinity-vm-28-20260921-13e05dd7-video\research-profile.v2.json' --inventory '.\deploy\infinity\inventory.worker-28.json' --viewer-token-file "$env:TEMP\HomunculusDiagnostics\infinity-research-20260921\viewer-token.txt"
```

```powershell
Set-Location 'C:\Users\User\Desktop\Project\Homunculus AI\dashboard'
npm.cmd run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

Backend yalnız `127.0.0.1:8767`; Vite `/infinity-research` yolunu oraya iletir.
Başka bir bilgisayardaki tarayıcıdan bu yerel oturuma erişilmez. Gerçek Homunculus
web sunucusuna dağıtım yapılmadı; dağıtımda HTTPS, uygulama yetkilendirmesi ve aynı
origin reverse proxy ayrıca bağlanmalı. Eski `serve_infinity_preview.py` (8765)
bu yeni ekranın varsayılan veri kaynağı değildir.

## Kontrollü canlı karşılaştırma

Kullanıcı .28 monitör ekranına erişebildiğini doğruladı. Worker'ın mevcut UDP2050
alıcısı çalışırken ikinci UDP alıcısı başlatma. Hazırlanan standalone araç Linux
`AF_PACKET` ile ens3 üzerinde gelen çerçeveleri pasif okur. Promiscuous mode,
yeni multicast aboneliği, cihaz komutu, firewall/rota veya systemd değişikliği yapmaz.
Mevcut collector'ın multicast aboneliği açık olmalıdır.

**Windows PowerShell:**

```powershell
scp -o StrictHostKeyChecking=yes "C:\Users\User\Desktop\Project\Homunculus AI\homunculus-engine\scripts\capture_infinity_validation.py" sysadmin@172.100.101.74:/home/sysadmin/
```

**Worker SSH (`sysadmin@test-h-worker`):**

```bash
sudo python3 /home/sysadmin/capture_infinity_validation.py --duration 60
```

`READY` ve başlangıç UTC zamanı çıktığında monitörü 60 saniye videoya al veya
0/15/30/45/55. saniyelerde HR, SpO₂, PLS, RESP ve varsa yıldız/boş değer durumunu not et.
Hasta adı/kimliğini kayda alma. Saat eşleştirmesinde video/kayıt gecikmesini ayrıca not et.

Araç yalnız `.28:2564 -> 224.0.2.28:2050` tam IPv4/UDP paketlerini yazar;
fragmentleri ve hosttan çıkan paketleri dışlar. Sınırlar 60 saniye, 5000 paket,
8 MiB. RAW PCAP ile summary dosyaları `/home/sysadmin/infinity-validation-<UTC>-<id>/`
altında 0700/0600 izinlerle oluşur; dizin kullanıcıya devredilir. Kullanıcı bu özel
klasörü SCP ile repo dışındaki yakalama arşivine alır. Ekran notları da repo dışında kalır.

Timestamp worker'ın userspace alım zamanıdır; cihaz zamanı değildir. Socket drop
sayısı bütün AF_PACKET soket trafiği içindir, cihaz sıra numarası kaybı anlamına gelmez.
Sıfır paket yeni ağ kurulumu gerektiğini kanıtlamaz; önce araç çıktısı ve mevcut
metadata servisinin durumu incelenir.

### İlk canlı doğrulama denemesi ve araç düzeltmesi

21 Eylül 11:22:42 UTC'de kullanıcı 60 saniyelik ilk denemede sıfır paket gördü;
dizin `/home/sysadmin/infinity-validation-20260921T112242Z-388a9d3e`.
Bu deneme sayısal karşılaştırma için veri üretmedi; transport kesintisi kanıtı değildir.

Araçta AF_PACKET soketinin `bind((interface, 0))` çağrısı hatalıydı: Linux 6.8
kernel'inde bu sıfır protokolü doğrudan bağlar ve paket alımını devre dışı bırakır.
[Linux 6.8 kaynak kodu](https://github.com/torvalds/linux/blob/v6.8/net/packet/af_packet.c)
ve [CPython 3.12.3 adres dönüşümü](https://github.com/python/cpython/blob/v3.12.3/Modules/socketmodule.c)
incelendi. Worker'ın kernel sürümü henüz ayrıca alınmadı; sahadaki sonuç tekrar test edilmeli.

Güncel araç (summary `capture_tool_version=2`) protokol sıfırla açılır ve
`bind((interface, 3))` ile yalnız seçilen NIC üzerinde ETH_P_ALL etkinleştirilir.
Python adres tuple'ındaki protokol host byte order'dadır. `getsockname()` ile
bağlı NIC/protokol doğrulanmadan READY basılmaz. Ayrıca her 10 saniyede hedef
paket gelmese de frame/selected/filtered/outgoing sayaçları basılır; boş sonuç
`no_matching_packets`, `payload_saved=false` olur. Ağ/IGMP servisleri değişmez.
İki soket bağlama regresyon testi eklendi; ilgili 14 sentetik test geçti.

Güncel script aynı SCP komutuyla worker'a kopyalanmalı. Önce `--duration 10`
ile paket gelişi kontrol edilmeli; bundan sonra 60 saniyelik eşzamanlı ekran kaydı yapılmalı.

Yeni kayıtta önce kaynak, şekil ve guard kontrolleri; sonra bağımsız ekran
karşılaştırması yapılır. Uyuşmayan alan görünmez kalır. Bu turda yeni canlı kayıt
henüz alınmadı/doğrulanmadı; otomatik sürekli sayısal aktarım açılmadı.

## Test kanıtı

12 yeni sentetik backend testi; önceki preview/transport testleriyle toplam 48
backend testi ve 20 arayüz/yönlendirme testi geçti. Dashboard üretim derlemesi geçti
(mevcut büyük JS chunk uyarısı var). Yerel headless Chrome'da gerçek kayıtla dört
kart, masaüstü/390px mobil görünüm, yatay taşma olmaması ve logout sonrası sayıların
gizlenmesi kontrol edildi. Ekran görüntüleri yalnız kullanıcı TEMP dizininde.

Linux AF_PACKET alımı bu Windows ortamında canlı denenmedi; filtre için sentetik
Ethernet/VLAN, yanlış kaynak/grup/port, eksik paket ve fragment testleri geçti.
Klinik doğruluk, hasta değişimi ve 100 cihaz kapasitesi bu testlerden çıkarılamaz.
