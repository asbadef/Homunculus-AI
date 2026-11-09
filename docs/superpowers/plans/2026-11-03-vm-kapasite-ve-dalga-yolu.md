# VM kapasitesi ve dalga yolu — HBYS kurulum planına göre gözden geçirme

**Tarih:** 2026-11-03, gözden geçirme 2 2026-11-08 · **Yazan:** Lane A · **Niteliği:** karar belgesi değil; sahibin kararı için plan. Sahibin sözü
(03.11): «bunun planını kuralım; Lane C üzerinde HBYS kurulumu konusunu konuştuk, ona göre gözden geçir».
**Karşılaştırılan kaynak:** HBS birleştirme mimarisi planı (`~/.claude/plans/…c-radiant-music.md`, 25.10.2026, Azerbaycanca:
14 onaylı karar, §B proses topolojisi, §G kurulum paketi, §G2 S/M/L ölçülendirme, «Homunculus üzərində görüləcək işlər» H0–H3)
ve HBYS ayrıştırma kararları (02.11, `/c/tmp/homunculus-plans/hbys/kararlar.md`: H1 kişi kaydı → H7).
Hasta adı, numarası, değeri yoktur; yalnız sayılar ve sistem adları.

> **Numaralama uyarısı.** İki «H1» var: mimari planın **H1 = runtime stabilizasyonu** (Redis, worker, ingest ayrımı) ve
> ayrıştırma kararlarının **H1 = kişi kaydı**. Bu belgede ilki «**M-H1**» (mimari), ikincisi «**K-H1**» (kayıt) diye anılır.

**Gözden geçirme 2 (08.11, Lane A):** 4 vCPU sonrası ölçümler (M-1/M-2/M-3, 07–08.11) §1b'ye, IO-1 yazıcı ataması (08.11)
§1c'ye girdi; §3–§6 buna göre güncellendi. Karar 4 kapandı; altı karar açık. 03.11 metni olduğu gibi durur (tarih notlarıyla).

## 1. Bulgu (DALGA2 denemesi, 02–03.11; Lane B'nin kaydı)

Hub'ın yeni sürümü R8 (dalga çözümü ack'ten sonra ayrı iş parçacığında; okuma kilit dışında) kodun darboğazını kaldırdı:

| Pencere (UTC) | Panel | >500 ms | >1000 ms | paket_ms | commit_ms | Not |
|---|---|---|---|---|---|---|
| R6, A-3 (21:18) | kapalı | %1,57 | %0,20 | 41,6 | 22,6 | taban (dünkü temiz ömür: %2,29 / %0,73) |
| R8, B-2 (21:27) | kapalı | %1,02 | %0,06 | 41,8 | 22,5 | R6'dan temiz |
| R8, C-2 (21:41) | 1 | %1,84 | %1,17 | 49,0 | 22,9 | mutlak sınırlar içinde |
| R8, D-0 koşu 1 (21:49) | 1 | %2,11 | %1,48 | 48,1 | 23,0 | sınır içinde |
| R8, D-0 koşu 2 (21:55) | 1 | **%3,44** | %1,93 | **63,9** | **43,4** | **sınır dışı → G-1** (bayrak kapalı) |
| R8, G-1b (22:03) | yok, bayrak kapalı | %3,52 | %0,00 | 49,2 | 30,5 | tabanın 0,07 puan üstü; çözücü temiz |
| R8, sabah (07:54) | yok, bayrak **açık** | **%5,81** | **%3,66** | 54,1 | — | panel sorgusu yokken bile her tabanın üstü |

Okuma:
- Aynı panel yüküyle iki D-0 koşusu arasındaki fark **disk**: commit 23 → 43 ms, io full %2,9 → %5,8, wa en çok %49, işçi POST
  75 ms (= 500 ms diz noktası). Çözücü sağlıklı (dropped 0, queued 0); api CPU koşular arasında aynı (poll başına ≈27–34 ms, hepsi
  yetki: 9 asyncpg deyimi). Dünkü R7'ye göre (%27 / 542 ms / refused +172) ≈15× iyi.
- **Sabah penceresi** panel sorgusu yokken %5,81: artık ne panel ne çözücü; **gündüz VM yükü / disk** (ya da R8'in çözücü iş
  parçacığı disk baskısı altında — ayrılması için aynı yükte bir R6 penceresi gerekir: G-3 → 120 sn → G-3i = gündüz iki hub
  yeniden başlatması). `waves.refused` gece +1542: paneller açıkken >3 sn geç çözümler (yalnız görüntü).
- Sahip (02.11 22:01Z) paneli **açık bıraktı**, «yarın CPU ekleyeceğim» dedi; sabah itibarıyla nproc hâlâ 2, VM yeniden başlamadı.
  Lane B'nin sapması: G-1b tabanın üstündeyken G-3 çağrılmadı (sahip paneli geri istedi; R8 = R6'nın sayı yolu; IO kuyruğunu G-3
  düzeltmezdi) — kayıtlı.

**VM'nin gerçeği (salt okunur, 03.11):** 2 vCPU (Xeon E5-2683 v4, 2016, 2,1 GHz, VMware), 8 GB RAM, **24 GB tek disk, %86 dolu
(3,4 GB boş)**. Üzerinde bizim 4 konteynerden (toplam ≈200 MB RAM) başka **MicroK8s (kubelite, k8s-dqlite, calico-node ×3),
mysqld, containerd, redis-server, snapd** çalışıyor; kubelite tek başına 350 MB. PSI: cpu some ≈%6–7, io full ≈%3–6 (sabah 3,2–3,8).

**VM'nin 03.11'deki durumu:** kod 3e0f2b0; api 6a981248 / web d71ce62f (dalga2 imajları); `INFINITY_WAVES=on`; hub R8
transport-3473891380ecc72e + 97-dalga.conf; `:pre-dalga2` = G3'ün imajları (508d1802 / b9a4cbb1); alembic 0015; köprü, nce dokunulmadı.

### 1b. 4 vCPU sonrası (07–08.11; Lane B'nin DALGA2-ÖLÇÜM kaydı, Lane A okudu)

Sahip VM'i 03.11 08:10Z'de büyüttü: **4 vCPU, ≈10 GB RAM**; kök disk 24 → 48 GB (DISK-1, 03.11) → **58 GB, %36 dolu** (DISK-1b,
08.11 09:59Z, çevrimiçi, yeniden açılış yok). Aynı datastore, aynı tek disk. Hub R8 aynı sürüm (transport-3473891380ecc72e).

| Pencere (UTC) | Panel | >500 ms | >1000 ms | paket_ms | commit_ms | hub CPU | Not |
|---|---|---|---|---|---|---|---|
| M-1 taban (07.11 19:18) | kapalı | %0,19 | %0,00 | 44,9 | 26,2 | %10,5 | R8 tabanı, 4 vCPU; io full %2,22 |
| M-2 #1 (07.11 19:40) | 1, arka planda | %5,89 | %4,97 | — | 33,7 | — | **GEÇERSİZ ve KİRLİ:** 21 okuma; sahibin aynı dakikalarda yapıştırdığı DISK-0 (host geneli SCSI taraması) IO'yu ≈10 sn durdurdu → **kanıt değil, silindi** |
| M-2 #2 (07.11 19:50) | 1 | %1,38 | %0,00 | 41,5 | 23,0 | %10,6 | KABUL; api ≈30 ms/yoklama (yetki) |
| M-3 #1 (08.11 09:02) | 1, yoklamıyor | — | — | 75–80 (dk7–8) | 54–58 | — | blok dk8'de kesti; dk1 fwupd-refresh ≈11 MB; **09:08–09:10Z ≈2,5 dk depolama yavaş** (wa %3–4, bo/bi/cpu düz, zamanlayıcı yok) |
| M-3 #2 (08.11 09:10, 553 sn) | 1, önde | %1,01 | %0,03 | 39,5 | 21,3 | %10,6 | **KABUL**; 670 yoklama ≈31 ms; refused +0; wa tek-saniye sıçramaları (en çok 19, 8 sn) |

Okuma:
- **4 vCPU CPU tarafını kapattı:** tek panelle 1000 ms kuyruğu %1,5–1,9 → %0,03; paket_ms 48–64 → 39,5. Beş hub CPU yan yana:
  R6 A-3 %9,3 · R8 B-2 %10,2 · D-0 %9,9 · M-1 %10,5 · M-3 %10,6 → panelin hub'a maliyeti ≈0,1 puan; 500 ms kuyruğuna ≈0,3–0,5
  puan; API'ye ≈31 ms/yoklama (yetki; dalga-perf-2'nin 3b maddesi, değişmedi).
- Sahip (08.11): ekran 10 dk **akıcıydı**; G-1 sözü yok → bayrak açık kaldı (iki hattın okuması: kalan kuyruk depolama, bayrak değil).
- **Düzeltme (03.11 metnine):** «sabah %5,81» 2 vCPU dönemine aittir (M-1 aynı hub, 4 vCPU, panelsiz: %0,19); M-2 #1'in
  duraklaması DISK-0 kirliliğidir. **Kalan depolama kanıtı:** D-0 koşu 2 (03.11), M-3 #1'in 2,5 dk yavaş dönemi, M-3 #2'nin
  tek-saniyelik wa sıçramaları, gece panelsiz refused +2754, IO-1'in 12:55:03Z duraklaması (§1c).
- **Yeni kural:** host geneli SCSI taraması (`- - -`) bu VM'in IO'sunu ≈10 sn durdurur; bir daha yalnız tek-aygıt taraması,
  ölçüm dışında, Lane A'ya haber vererek.

### 1c. IO-1 — VM içindeki yazıcı kim (08.11 12:51:23–12:56:23Z, 300 sn, salt okunur; Lane B yazdı ve okudu, Lane A ham dosyalardan doğruladı)

Soru: 500 ms kuyruğunu VM içi zamanlanmış yazıcılar mı sürüyor, VM altındaki depolama mı? Yanıt: **yükün kaynağı hub'ın kendi
kalıcı kuyruğu, duraklamaların kaynağı depolama; zamanlanmış yazıcılar değil.**

| Ölçü | Değer |
|---|---|
| VM yazma yükü (sda) | 606 MB / 300 sn = **2,07 MB/s, 227 IOPS**; okuma 0; flush 0; meşguliyet **%6,4**; dm-0 aynı 606 MB |
| hub servisi (cgroup io.stat Δ) | **500 MB = %82,6**; 62 909 aygıt yazması; 842 write syscall/sn; değişen tek hub dosyası `/var/lib/homunculus-infinity-pilot/archive.sqlite` (244 MB) |
| hiçbir dilimde olmayan (kök − system.slice − user.slice) | **81 MB = %13,4** → çekirdek ext4 günlüğü (jbd2; her commit'te günlük dosyası aç/sil + fsync). Raporun «atanmamış 0,0» satırı hesap hatası (kök − aygıt yazılmış); io1 r3'te düzeltilecek |
| öteki yazıcılar | nextcloud mysqld 13 MB (%2,2) · k8s-dqlite 8,3 MB (%1,4) · containerd ≈1,6 MB · homunculus postgres 0,44 MB (1 zamanlı checkpoint, 11 tampon) · journald 0,3 MB · docker kap günlükleri ≈0,05 KB/s · fwupd pencerede yok (son 12:31Z, sonraki 13:58Z) |
| depolama (saniyelik yazma gecikmesi) | **medyan 3,3 ms, p95 6,2 ms**, 299/300 sn sağlıklı; **12:55:03Z tek duraklama:** 148 yazma/sn, 1,5 MB/s (ortalamanın altı), gecikme 167 ms, PSI io full 230 ms/sn, wa %10–11 → **VM altı imzası** (yazıcı patlaması değil); ikinci en kötü saniye 24 ms |
| hub aynı pencerede | KABUL: CPU %10,6; 19 210 paket; >500 %0,60; >1000 %0,00; paket_ms 39,2; refused +0; **append 26,6 ms'nin 20,7'si commit**; 922 commit: 912'si 10–50 ms, 4'ü 50–100, 2'si 100–250, 3'ü 250–500 ms |

Kodla eşleme (Lane A; `homunculus-engine/src/homunculus/edge/infinity_journal.py`, `infinity_collector.py`):
- Hub Journal'ı **kalıcı bir kuyruk**tur, arşiv değil: `append` şifreli satırları ekler, işçinin ack'i siler; dosya büyümez
  (244–256 MB), **her gönderi bir commit**tir. `PRAGMA journal_mode=DELETE` + `synchronous=FULL`: her commit'te rollback günlüğü
  yazılır + fsync, veri sayfaları yazılır + fsync, günlük dosyası silinir. 500 MB'ın tamamı **yazma çoğaltması**dır (değişen sayfa
  iki kez, üstüne ext4 günlüğü); kuyruğa giren gerçek veri bunun küçük bir parçası.
- `append` sözleşmesi: «Atomic batch: **ack only after commit**». Sözleşmeye dokunmadan yazmayı azaltan düğme **WAL kipi +
  `synchronous=FULL`**: değişen sayfa her commit'te bir kez WAL'a yazılır, tek fsync; veri dosyası checkpoint'te güncellenir.
  `synchronous=NORMAL` (güç kesintisinde son commit'ler kaybolabilir) ve **toplu commit** sözleşmeye dokunur: ayrı dayanıklılık
  kararı. Hepsi ayrı kod dilimi (dalga-perf-2 madde 2); eski sürüm hub'ı açılışta kipi geri alır (DELETE her açılışta yazılır).
- **45 sn'de bir sessiz saniye** (12:51:37, 12:52:22, 12:53:07, 12:53:52, 12:55:22; 6–14 yazma/sn): işçinin (.74) toplayıcısı
  her 45 sn'de çoklu-yayın üyeliğini bırakıp 2 sn sonra yeniden katılır (`collect`: `refresh_interval=45`, `rejoin_gap=2`; sahadaki
  yukarı akış budaması 89–193 sn'de akışı kestiği için bilinçli tasarım). Bu bir **alım boşluğu**dur, gecikme kuyruğu yapmaz; depolama
  değil. Yalnız kayıt.
- Güne vurulursa hub ≈144 GB/gün, VM ≈175 GB/gün yazma. SSD alınırsa **TBW hesabına bu girer**; WAL ile belirgin düşmesi beklenir
  (ölçülmeden sayı verilmez).
- Temizlik notu (performans değil): api/web/postgres kaplarında json-file günlük döndürmesi yok (`{}`), daemon.json yok; web günlüğü 19,3 MB.

**Okuma:** Depolama ortalama yükte rahat (%6,4 meşgul; 2 MB/s). Sorun **senkron commit gecikmesi** (her gönderide iki fsync;
gönderi süresinin yarısından çoğu) ve **seyrek depolama duraklamaları** (300 sn'de bir; M-3 #1'de 2,5 dk). İki kol birbirini
tamamlar: (a) daha düşük gecikmeli datastore/SSD her commit'i kısaltır ve duraklamaları azaltır; (b) WAL + FULL commit başına
yazma ve fsync sayısını düşürür, depolamanın her takılmasının gönderi yoluna binme payını küçültür. (b) ucuz, ölçülebilir,
sözleşmeyi korur; (a) sahibin ve hastane BT'nin kararı.

### 1d. dalga-perf-2 VM'de (09.11 08:00–13:26Z; Lane B yazdı, Lane A yürüttü ve okudu, Lane B bağımsız okudu; KOŞULDU `DALGAPERF2-bloklari.txt` sonunda)

Hub R8 → **R9 (`journal_mode=WAL` + `synchronous=FULL`, ack-sonrası-commit sözleşmesi aynı)**, api **3b** (`resolve_scope` tek oturum / iki deyim),
kod main 3e0f2b0 → **14b4a642**. Blok sırası A-1 → A-2 → IO ÖNCE → B-1 (11:33Z) → IO SONRA → C-1 → C-2 → C-3 → D-0; geri dönüş (G-1/G-2/G-3)
kullanılmadı. Aynı io1 r3 bloğu R8'de ve R9'da (hub ≥ 10 dk yatıştıktan sonra), 300 sn, panelsiz:

| Ölçü | ÖNCE (R8, 08:53–08:58Z) | SONRA (R9 WAL + FULL, 11:45–11:50Z) |
|---|---|---|
| VM yazma (sda) | 68 898 istek, 617 MB → 229 IOPS, 2,10 MB/s; meşguliyet %6,4 | 38 427 istek, 493 MB → 128 IOPS, 1,68 MB/s; meşguliyet %4,2 (**istek −%44, bayt −%20**) |
| hub süreci (`/proc/<pid>/io`) | 505 MB (%82), 254 850 write syscall; gönderi başına 558 KB / 275 syscall | 428 MB (%87), 173 897 syscall; gönderi başına 458 KB / 182 syscall (**−%18 / −%34**) |
| aygıt, gönderi başına | 74,3 yazma, 682 KB | 40,1 yazma, 527 KB |
| hub commit | **20,2 ms**; kovalar ≤10/≤50/≤100/≤250/≤500 ms: 0 / 920 / 2 / 1 / 5 | **10,4 ms**; 844 / 89 / 24 / 1 / 1 (≤10 ms = %88) |
| gönderi (paket_ms) / işçi post | 39,3 / 51,1 ms | **26,8 / 39,0 ms** |
| ext4 günlüğü (jbd2) · atanmamış çekirdek | 5,0 işlem/sn (1,62/gönderi) · 86 MB = %13,9 | 1,9/sn (0,58/gönderi; hub payı ≈0, kalan arka plan) · 40 MB = %8,1 |
| depolama, istek başına gecikme | ort 3,7 ms; medyan 3,2; p95 5,0; en çok 36,5 | ort 7,1; medyan 3,7; p95 8,2; en çok 71,4 — **Little yasası, aygıt pahalılaşmadı:** meşgul süre 19,2 → 12,6 sn (−%34), meşgulken derinlik 13,3 → 21,7 (checkpoint sayfaları fdatasync'te toplu kuyruğa giriyor); tek eşzamanlı yazma hâlâ ≈3–4 ms |
| hub aynı pencerede | CPU %10,9; >500 ms %0,74; refused +0 | CPU %10,1; >500 ms %0,20; refused +0; dropped 0; uyarı 0; `archive.sqlite-wal` 4,26 → 4,47 MB (sabit sayılır); `archive.sqlite` 255 873 024 B değişmedi |
| **D-0, tek panel 180 sn** | 07.11 M-2 #2 (R8, eski api): paket 41,5 ms; >500 ms %1,38; commit 23,0; api ≈31 ms/yoklama | **13:23Z KABUL:** paket 25,4; >500 ms %0,01; commit 9,2; hub CPU %10,5; **api 26,4 ms/yoklama (3b, −%15)**; 220 okuma/180 sn; sahip: ekran «akıcıydı» |

- **Kapasite planına giren iki sayı.** WAL: commit 20,2 → 10,4 ms (D-0'da 9,2); VM yazma isteği −%44, bayt −%20; hub (süreç) −%18 bayt, −%34
  syscall; packets 39,3 → 26,8; **TBW girdisi ≈178 → ≈142 GB/gün VM, ≈145 → ≈123 GB/gün hub.** 3b: api CPU 31 → 26,4 ms/yoklama (bench'teki
  5,99 → 3,13 ms/çözüm ile uyumlu); 3b'nin duvar süresi VM'de ölçülmedi (bench 18,9 → 8,9 ms/çözüm). Paket süresindeki kazanç WAL'ındır, 3b'nin değil.
- **cgroup muhasebesi (io1 r4 notu).** Hub yeniden başlatılınca systemd aynı yolda yeni cgroup açar; `archive.sqlite`'ın önbellek sayfalarının
  writeback sahipliği ölü cgroup'ta kalır ve checkpoint yazıları `system.slice`'a (hiçbir yaprağa değil) akar: SONRA'da hub yaprağı 262 MB +
  yaprak dışı 166 MB = süreç 428 MB. Hub payı için süreç sayısı esas; «hub cgroup» satırı yeniden başlatmadan sonra yanıltıcı.
- **Checkpoint commit'in içinde.** Yavaş commit kuyruğu 115/958 (%12) ≈ WAL döngüsü sayısının iki katı; 11:47:30Z tek patlama saniyesi (458
  istek/sn, 70 uçuşta, 71 ms) büyük bir checkpoint. Aday dilim: **arka plan checkpoint** (`wal_autocheckpoint=0` + istek yolu dışında PASSIVE) —
  sınırların içindeyiz, şimdi gerek yok; sahibin sıraya koyması.
- Kayıtlar: `/c/tmp/infinity-a-releases/dalgaperf2-{io-once-085323Z,b1-1133Z,io-sonra-114531Z,c1-c2-c3,d0}.txt`; VM `~/dalgaperf2/`; D-0 #1
  (12:46Z) ekran açık değildi (nginx'te tarayıcı isteği 0), 13:17Z koşusu 124 okuma ile GEÇERSİZ; ikisi de karar penceresi değil.

## 2. HBYS kurulum planı ne diyor (ilgili kısımlar)

- **Karar 6–7:** «Linux VM'leri biz kurarız»; pilot saha **orta (M)**: 50–200 yatak, 30–150 kullanıcı, 20–100 cihaz.
- **§G2 ölçülendirme:** S = 1 VM 8 vCPU / 32 GB / 1 TB + 1 EDGE; **M = APP 12 vCPU/32 GB + DB 8 vCPU/32 GB/1 TB (ayrı VM)**,
  1–2 EDGE VM; kurulum sırası hipervizör → VLAN/WireGuard → DB VM → STORE → APP → EDGE → izleme → go-live, 3–5 iş günü.
- **§B topoloji:** `gateway`, `api` (2 replika × 2 işçi), **`ingest` ayrı proses** (yalnız cihaz yolları), **`clinical-worker`
  motorun sahibi** (HTTP servis etmez), `worker-jobs`, `redis`, `postgres` (Timescale), `alloy`; edge ajanları
  (`infinity-collector`, `hl7-bridge`, `nce-bridge`) **EDGE VM'de**, yalnız HTTPS ile ingest'e konuşur.
- **§E donma-karşıtı:** api'de uzun döngü yok; bağlantı bütçesi; CPU-ağır iş worker'da; sıcak okumalar Redis hash'ten;
  compose'da kaynak tavanları.
- **M-H1 runtime stabilizasyonu:** (a) Redis + worker-jobs + çok replikalı api; eskalasyon döngüsü api'den çıkar;
  Broadcaster → Redis pub/sub; **kapsam (scope) çözümü Redis'te 30 sn önbellek**; (b) vital tablosu (Timescale), rehydrate
  tablolardan; (c) **ingest ve motor ayrılır** (ingest < 50 ms/batch; motor `clinical-worker`'da); (d) compose.
- **§H riskler:** R1 clinical-worker tek instans; R2 tek Postgres; R9 denetim zinciri çok-prosesli çekişme.

## 3. Üç seçeneğin plana göre durumu

| Seçenek | Plana göre | Yargı |
|---|---|---|
| **1. VM'i büyütmek** (4 vCPU, hızlı/ayrı disk) | Plan M kademesi için **ayrı APP ve DB VM'leri** ister; bugünkü .72 planın öncülüne (bize ait, adanmış VM) uymuyor: MicroK8s + MySQL ile paylaşımlı. | **CPU yapıldı (03.11, 4 vCPU): 1000 ms kuyruğu kapandı (M-3 %0,03).** Disk 58 GB'a büyüdü ama aynı datastore; IO-1 depolamanın 300 sn'de bir ≈170 ms durduğunu, M-3 #1 2,5 dk yavaşladığını gösterdi. **Ayrı/düşük gecikmeli datastore** hâlâ açık; yazma yükü ≈2 MB/s (TBW ≈175 GB/gün bugünkü kipte). |
| **2. Hub kaydının commit maliyeti** | Planda hub = edge ajanı, **EDGE VM'de**, kendi diskinde; APP/DB diskini paylaşmaz. Araştırma yolu (`clinical forwarding DISABLED`). | **Artık ölçülü: VM yazmasının ≈%96'sı bu yol** (IO-1, §1c). Commit 21–58 ms, gönderinin yarısından çoğu. Sıra: önce **WAL + FULL** (sözleşme aynı), sonra gerekirse `synchronous`/toplu commit (dayanıklılık kararı). Tıbbi yolu etkilemez. Yerel bench'te commit_ms + VM'de IO-1 yeniden koşusu ile doğrulanır. |
| **3. Panel sorgusunun 9 yetki deyimi** | Plan M-H1(a)'da **kapsam çözümü Redis'te 30 sn önbellek** ve api 2×2 işçi diyor; Redis henüz VM'de yok. | **İki adımlı.** Önce (b): `resolve_scope`'un 8 deyimini birleştirmek — anlam değişmez, her JWT yolu kazanır, Redis'siz. Sonra M-H1(a) ile 30 sn Redis önbelleği (planın kararı; yetki geri alma penceresi 30 sn — uygulamada bir kez daha teyit). |

Planın görmediği, ölçülen üçüncü neden: **api tek işçi** (A-29: motor api içinde) ve motor HTTP ile aynı proseste. Panel sorguları,
13 monitörün POST'larını alan hub ve motoru koşturan api ile aynı iki çekirdeği paylaşıyor. Planın M-H1(c)'si (ingest ayrı, motor
`clinical-worker`'da) tam bunu çözer; dalga panelinin kalıcı yeri orasıdır.

## 4. Önerilen yol

**Faz 0 — VM (sahip + hastane BT; kod yok).** Sahibin «CPU» kararına ek:
1. **CPU: YAPILDI** (03.11 08:10Z: 4 vCPU, ≈10 GB; yeniden açılış; taban M-1 ile yeniden alındı). Planın S kademesi 8; pilot 4 ile
   sınırların içinde (M-3 #2).
2. **Disk:** alan sorunu kapandı (kök 24 → 48 → **58 GB, %36 dolu**; DISK-1 03.11, DISK-1b 08.11, çevrimiçi). **Gecikme sorunu açık:**
   postgres + hub kaydı için **ayrı bir SSD disk ya da düşük gecikmeli datastore** (IO-1: ≈2 MB/s, 227 IOPS, iki fsync/gönderi; TBW
   girdisi ≈175 GB/gün bugünkü kipte, WAL sonrası ölçülecek). Kural: bu VM'de host geneli SCSI taraması yok.
   **09.11 WAL sonrası ölçüldü (§1d):** VM yazma ≈1,7 MB/s, 128 IOPS (istek −%44, bayt −%20); **TBW girdisi ≈142 GB/gün VM, ≈123 GB/gün
   hub**; tek eşzamanlı yazmanın maliyeti ≈3–4 ms değişmedi (istek başına ortalama 7,1 ms Little yasasıdır, girdi değil). **BT = sahibin
   kendisi (09.11):** SSD / düşük gecikmeli datastore kararı sahibindir; girdi bu sayılar.
3. **Komşular:** .72'deki MicroK8s + mysqld kime ait, taşınır mı — hastane BT'ye soru. IO-1 komşuların **disk yazmasında küçük**
   olduğunu gösterdi (mysqld %2,2, dqlite %1,4): soru RAM/CPU paylaşımı (kubelite 350 MB) ve VM'nin sahipliği içindir, IO için değil.
   **BT = sahibin kendisi (09.11):** soru dışarıya değil, sahibe. D-0 #2 anlık top: kubelite %15, k8s-dqlite %8 CPU (sürekli), mysqld %8;
   disk yazması yine küçük (mysqld %2,6, dqlite %1,8).
4. **Hedef:** M kademesi (APP 12/32 + DB 8/32/1 TB) yeni VM'lerde = planın kurulum sırası (3–5 iş günü). Pilotun «büyütülmüş
   .72»den «planın sahası»na geçişi; zamanı sahibin.

**Faz 1 — küçük kod dilimi «dalga-perf-2» (Lane B; VM'e tek dağıtım kuralıyla).** **ONAY 09.11 — sıra: 2 (WAL/FULL) → 1 (3b) → 3 (hubdurum).** **KOŞULDU 09.11 — VM'de canlı (hub R9 WAL + FULL, api 3b, kod 14b4a642); D-0 KABUL; geri dönüş kullanılmadı; ölçüm §1d.**
1. `resolve_scope` 8 → ≈2 deyim (3b): anlam değişmez; `test_api_scope` + yetki tabloları testleri; ölçüm: api CPU/poll.
2. Hub kaydı commit maliyeti (2): **önce WAL + `synchronous=FULL`** (ack-sonrası-commit sözleşmesi aynı), ölçüm; sonra gerekirse
   `synchronous=NORMAL` / toplu commit (dayanıklılık kararı, sahibe). Bench'te commit_ms; VM'de IO-1 yeniden koşusu (hub payı,
   fsync/gönderi, commit satırı). io1 r3: atanmamış = kök − dilimler; vmstat çocuğu da öldürülür.
3. hubdurum: D-0 geçerlilik tabanı ≈150 okuma/180 sn (1 panel ≈1,0/sn); yeniden başlatma sonrası yeni taban kuralı; `refused`
   sayacı kayda.
4. Çıkış ölçütü aynı: mutlak sınırlar (paket ≤ 60 ms, >500 ≤ %3, >1000 ≤ %2, çözücü sağlıklı, PSI cpu ≤ %35) + sabit taban.

**Faz 2 — M-H1 runtime stabilizasyonu (planın kendi işi; dalganın kalıcı yeri).**
M-H1(a) Redis + worker-jobs + api 2×2 + kapsam önbelleği 30 sn + eskalasyon döngüsü worker'a; M-H1(c) ingest/motor ayrımı.
Her biri ayrı VM dağıtımı + geri dönüş. **Bu iş ayrıştırma sırasında (K-H1 → K-H7) yer almıyor**; sahibin sıraya koyması
gerekir (öneri: K-H1 kişi kaydı ile paralel hat; dalga ve ekran sayısı artmadan, K-H5 ayaktan ekranlarından önce).

**Dalga paneli bu arada:** açık (sahip 02.11; 08.11 «akıcıydı», G-1 yok). 4 vCPU ile tek panel mutlak sınırların içinde (M-3 #2);
disk değişmeden seyrek takılmalar sürer (M-3 #1'in 2,5 dk'sı). Alarm yolu ve kartlar etkilenmez (3 sn sınırı %100); bedel şeridin
tazeliği ve geç çözülen dalga blokları (yalnız görüntü).

## 5. Sahibin kararları

1. **Depolama — KARAR (09.11, sahip «önerini yapalım»):** önce yazılım — Faz 1'in WAL + `synchronous=FULL` dilimi (dalga-perf-2,
   Lane B); sonra IO-1 yeniden koşusu; ayrı SSD / düşük gecikmeli datastore BT'ye ölçülmüş sayıyla sorulur (TBW girdisi: bugün
   ≈175 GB/gün, WAL sonrası ölçülen değer). CPU kısmı yapıldı. BT'ye henüz gidilmedi.
   **09.11 ölçüldü (§1d):** commit 20,2 → 10,4 ms; VM yazma isteği −%44, bayt −%20; TBW ≈178 → ≈142 GB/gün VM. **BT = sahip (09.11):**
   SSD / düşük gecikmeli datastore artık dışarıya soru değil, sahibin kararı; girdi hazır.
2. **.72'nin komşuları:** MicroK8s/mysqld taşınır mı, .72 kalıcı pilot sunucu mu? (BT'ye soru; cevaba göre M kademesi takvimi.) **09.11: BT = sahibin kendisi; soru doğrudan sahibe (Lane A soruyor).**
3. **M kademesi yeni VM'ler:** ne zaman? (Planın 3–5 günlük kurulumu; G3/B1d/dalga blokları yeni sahaya uyarlanır.)
4. ~~R6 karşılaştırma penceresi~~ **KAPANDI (08.11):** M-1 (R8, panelsiz, 4 vCPU) %0,19 / %0,00 — sabah %5,81 R8'e değil 2 vCPU +
   depolamaya aitti; iki gündüz yeniden başlatması gerekmez.
5. **Faz 1'in sırası — KARAR (09.11; karar 1'in onayı dalga-perf-2'yi açtı):** dalga-perf-2 Lane B'de — sıra: WAL/FULL → 3b →
   hubdurum/io1 r3; kapsam 09.11 Lane A → Lane B yazıldı. VM'e tek dağıtım kuralıyla; geri dönüş eski hub sürümü (kipi açılışta
   kendi geri alır); `synchronous=NORMAL` / toplu commit bu dilimde yok (ayrı dayanıklılık kararı).
6. **M-H1 runtime stabilizasyonu** ayrıştırma sırasına nereye girer? (**Öneri:** K-H1 ile paralel, K-H5'ten önce.)
7. **Kapsam önbelleği 30 sn** (planın M-H1(a) kararı): yetki geri alma penceresi 30 sn — teyit.

## 6. Açık gerçekler
- .72'nin sahibi/amacı ve komşu iş yükleri: **BT = sahibin kendisi (09.11)** — karar 2 sahibe doğrudan.
- vCPU değişikliği VM'i yeniden başlatır; hub ömrü ve R6/R8 tabanı sıfırlanır; A-3 tarzı taban yeniden alınır.
- `waves.refused` gece sürüklenmesi (M-1 → M-3 +2754, panelsiz): panelli pencerelerde ve IO-1'de +0; kaynağı açık — gece depolama
  duraklamaları adayı. Ömür 24 760 (08.11) → 28 117 (09.11 sabah, +3357/gün); R9 açılışından sonra 88 (B-1 duraklaması), sonra +0 — WAL sonrası gece sürüklenmesi izlenecek.
- Toplayıcının 45 sn üyelik yenilemesi 2 sn alım boşluğu demek (tasarım gereği, saha budamasına karşı): dalga şeridinde her 45 sn'de
  ≈2 sn eksik. Kapasite konusu değil; ayrı not.
- IO-1 ham dosyaları: VM `~/dalga2/olcum/io1-125120Z/`; KOŞULDU `IO1-bloklari.txt` sonunda (Lane B) + Lane A EK'i.
- dalga-perf-2 ham dosyaları: VM `~/dalgaperf2/` (io-once-085323Z, io-sonra-114531Z, d0-132308Z); iş istasyonu `/c/tmp/infinity-a-releases/dalgaperf2-*.txt`;
  KOŞULDU `DALGAPERF2-bloklari.txt` sonunda (Lane B), koşulan r3 kopyası `.r3.txt`.
- cgroup v2 `io.stat` hub yeniden başlatıldıktan sonra hub'ı eksik gösterir (§1d); hub payı için süreç `/proc/<pid>/io` esas.
- `feat/dalga-perf-2` (14b4a642) VM'de canlı ama **main'de değil, itilmedi**; «main'e al» (yalnız ileri sarma) sahibin sözüyle.
- Bu belge karar üretmez; kararlar roadmap'e ve ilgili spec'lere yazılır.
