# Sürekli Infinity araştırma akışı

> **Son durum:** Hub research upgrade ACTIVE çıktısı kullanıcı tarafından paylaşıldı.
> Worker için “hazır” yanıtı geldi; tam çıktı yok. Kullanıcı yerel 5175 ekranında veri
> göremediğini bildirdi. Asıl uygulama entegrasyonu için güncel devir:
> [Claude Code production handoff](../HANDOFF-CLAUDE-INFINITY-PRODUCTION-2026-09-21.md).
> Aşağıdaki kurulum sırasını yapılmış adımları kontrol etmeden tekrarlamayın.

21 Eylül 2026: Kullanıcı tek seferlik 60 saniyelik gösterim yerine gerçek cihaz
verisinin 7/24 akmasını istedi. Eski PCAP döngüye alınmadı. Canlı research decoder,
aynı çalışan worker/hub aktarımına isteğe bağlı eklendi. **Bu dosya yazılırken
VM güncellemesi henüz kullanıcı tarafından çalıştırılmadı; mevcut pilot metadata modunda.**

## Davranış ve sınırlar

`10.10.203.28 → Ubuntu worker → mevcut TLS hub → araştırma ekranı`.
Worker/hub servislerinin süre sınırı yoktur; tarayıcının açık kalması gerekmez.
Süreç hatalarında mevcut systemd restart politikası kullanılır; 60 saniyelik
yakalama aracı ayrı bir tanı aracıdır, sürekli akışı yönetmez.

Hub'ın `--unverified-live-research PROFILE --capture-payload` seçeneği canlı
payload'lardan dört aday alan çıkarır. Kaynak, multicast grup, port, paket boyu ve
alan öncesi byte kontrolleri sürer. Profilin PCAP SHA kapsamı yalnız replay için
kanıttır; canlı kullanım açıkça ayrı `unverified_layout` kanıt düzeyindedir.
Profilin bilinmeyen yeni cihaz/firmware/paket düzeninde kullanılabilir olduğu
varsayılmaz. Alan birimi/ölçeği, geçerlilik bayrakları ve cihaz ölçüm zamanı henüz
doğrulanmadı. Hasta eşleştirmesi, ECG dalgaları ve klinik ingest kapalıdır.

Her alan ayrı eskir. Üç saniyelik eşik worker'ın alım zamanı, hub'a taşınma süresi
ve monotonik saatle değerlendirilir. Eski kuyruk kayıtları ve tekrarlar güncel
ölçüm olarak gösterilmez. Saat gelecekteyse veya paket yapısı uymazsa sayılar
gizlenir. Yeniden bağlantıda taze ve eşleşen paketler gösterimi sürdürür.

Raw payload'lar sadece mevcut TLS hattından geçer ve mevcut Fernet şifreli
journallarda 128 MiB/100000 kayıt/1 saat sınırlarıyla tutulur. Bu ayarlar tek cihaz
pilotuna aittir; 100 cihaz kapasitesi doğrulanmadı. Disk üst sınırı ve paket
kaybı sayaçları izlenmelidir. Sunucu sertifikası 20 Aralık 2026'da sona eriyor;
7/24 işletim için yenileme/izleme işi ayrıca tamamlanmalı. Süre sınırı olmaması,
kesintisizlik veya klinik kullanım onayı anlamına gelmez.

## Güncelleme paketi

Windows'ta hazır dosya:
`%TEMP%\HomunculusDeploy\infinity-continuous-research-20260921.zip`.
SHA-256: `840b90d8f028a867547c0c088851a950c61c8b6e2d404483dbc4131d4428d3a1`.
Paket yalnız izinli kaynak dosyalarını içerir; PCAP, video, profil, anahtar veya
klinik sayısal seri içermez. Gerçek profil mevcut repo dışı arşivden ayrı gönderilir.

**Windows PowerShell** — komutları ayrı satırlar halinde çalıştır:

```powershell
scp -o StrictHostKeyChecking=yes "$env:TEMP\HomunculusDeploy\infinity-continuous-research-20260921.zip" sysadmin@172.100.101.72:/home/sysadmin/
```

```powershell
scp -o StrictHostKeyChecking=yes "$env:TEMP\HomunculusDeploy\infinity-continuous-research-20260921.zip" sysadmin@172.100.101.74:/home/sysadmin/
```

```powershell
scp -o StrictHostKeyChecking=yes "C:\Users\User\Desktop\Homunculus-Captures\infinity-vm-28-20260921-13e05dd7-video\research-profile.v2.json" sysadmin@172.100.101.72:/home/sysadmin/infinity-research-profile.json
```

## Önce hub

**Homunculus SSH (`sysadmin@homunculus`, .72)**:

```bash
python3 -m zipfile -e ~/infinity-continuous-research-20260921.zip ~/infinity-continuous-research-20260921
sudo /opt/homunculus-infinity/pilot/.venv/bin/python ~/infinity-continuous-research-20260921/enable_continuous_research.py hub --profile /home/sysadmin/infinity-research-profile.json
```

`CHECK OK` gelirse aynı hazırlanmış değişikliği uygula:

```bash
sudo /opt/homunculus-infinity/pilot/.venv/bin/python ~/infinity-continuous-research-20260921/enable_continuous_research.py hub --profile /home/sysadmin/infinity-research-profile.json --apply
```

Beklenen: `ACTIVE: continuous research hub; no duration limit; clinical_forwarding=false`.
Hub aktif sonucunu görmeden worker payload moduna geçme. Bu aşamada worker hâlâ
metadata gönderdiği için aday sayıların boş olması beklenir.

## Sonra worker

**Worker SSH (`sysadmin@test-h-worker`, .74)**:

```bash
python3 -m zipfile -e ~/infinity-continuous-research-20260921.zip ~/infinity-continuous-research-20260921
sudo /opt/homunculus-infinity/pilot/.venv/bin/python ~/infinity-continuous-research-20260921/enable_continuous_research.py worker
```

`CHECK OK` gelirse:

```bash
sudo /opt/homunculus-infinity/pilot/.venv/bin/python ~/infinity-continuous-research-20260921/enable_continuous_research.py worker --apply
```

Beklenen: `ACTIVE: continuous research worker; no duration limit; clinical_forwarding=false`.
Process health tek başına ölçüm geldiğini kanıtlamaz; ekran/status ve monitörle
eşzamanlı bağımsız karşılaştırma gerekir.

Helper rol IP'lerini, etkin/enabled mevcut unit'i, envanteri, kaynak hash'lerini,
profil şemasını ve başka override bulunmadığını kontrol eder. Yeni kod mevcut
pilotun yanına hash ile adlandırılmış release'e kurulur. Orijinal runtime/manifest,
venv, anahtarlar, TLS, journal, ağ ve Docker ayarları değişmez. Aynı pilot service
üzerine yalnız ExecStart/PYTHONPATH override uygulanır; ikinci UDP2050 alıcısı açılmaz.
Kısa restart aralığı olur. Başlatma sağlık kontrolü başarısızsa metadata unit'i geri yüklenir.

## Yerel ekranı gerçek hub'a yönlendirme

Ekran için **hub'ın viewer anahtarı** ve public CA gerekir. Collector/enrollment
anahtarını veya TLS private key'i kullanma. Windows PowerShell'de repo dışı klasöre al:

```powershell
$researchAccess = Join-Path $env:LOCALAPPDATA 'HomunculusResearchAccess'
New-Item -ItemType Directory -Force -Path $researchAccess | Out-Null
scp -p -o StrictHostKeyChecking=yes sysadmin@172.100.101.72:/home/sysadmin/infinity-viewer-token.txt "$researchAccess\viewer-token.txt"
```

CA dizini korumalıdır. Hub SSH oturumunda public
sertifikayı sysadmin'in evine dışa aktar; **server-key.pem veya ca-key.pem kopyalama**:

```bash
sudo install -o sysadmin -g sysadmin -m 0644 /etc/homunculus-infinity-pilot/ca.pem /home/sysadmin/infinity-research-ca.pem
```

Ardından Windows'ta yalnız public CA için şu kaynağı kullan:

```powershell
scp -o StrictHostKeyChecking=yes sysadmin@172.100.101.72:/home/sysadmin/infinity-research-ca.pem "$researchAccess\ca.pem"
```

Eski replay ekranını açık bırakıp canlı pilotu ayrı **5175** portunda başlat:

```powershell
Set-Location 'C:\Users\User\Desktop\Project\Homunculus AI\dashboard'
$env:INFINITY_RESEARCH_UPSTREAM = 'https://172.100.101.72:8766'
$env:INFINITY_RESEARCH_CA_FILE = "$env:LOCALAPPDATA\HomunculusResearchAccess\ca.pem"
Get-Content -Raw -LiteralPath "$env:LOCALAPPDATA\HomunculusResearchAccess\viewer-token.txt" | Set-Clipboard
npm.cmd run dev -- --host 127.0.0.1 --port 5175 --strictPort
```

`http://127.0.0.1:5175/?infinityTest=1` adresini aç, anahtarı yapıştır.
Başlık **CANLI PAKET TESTİ — DOĞRULANMAMIŞ** olmalı. Canlı görünümde replay
düğmesi yoktur ve 60 saniyede sonlanma olmaz. TLS CA ve IP doğrulaması açıktır;
`secure=false`/sertifika doğrulaması atlama kullanılmaz.

Bu yerel Vite ekranı pilot içindir. Homunculus'un mevcut production web Docker
imajına yeni frontend ve authenticated same-origin proxy dağıtımı bu değişiklikte
yapılmadı. Worker/hub tarayıcı kapalıyken de sürekli veri işlemeyi sürdürür.

## Geri alma

Önce worker'da aynı helper'a `worker --rollback` ver. Worker metadata moduna
döner; kuyruktaki payload'lar mevcut research hub'a boşalabilsin. Hub `/v1/status`
çıktısında collector kuyruğu sıfıra düştükten sonra hub'da `hub --rollback` ver.
Sıra önemlidir: payload kuyruktayken hub payload kabulünü kapatmak aktarımı bloke eder.
Helper yalnız kendi işaretli drop-in dosyasını kaldırır; kayıt/anahtar silmez.

## Test sonucu ve kalan doğrulama

46 decoder/live/transport testi, 13 aktivasyon/güncelleme testi, 21 UI/routing
testi ve üretim frontend derlemesi geçti. Bir test 30001 olayla 25 saati simüle eder;
bu gerçek 25 saatlik saha dayanıklılık testi değildir. Linux root/systemd update
uygulaması henüz burada çalıştırılamadı; kullanıcı SSH oturumundan uygulanacak.
Bağımsız ekran karşılaştırması, gerçek kesinti/reboot testi, TLS sertifika yenileme
ve çok cihaz kapasite çalışması hâlâ gereklidir.
