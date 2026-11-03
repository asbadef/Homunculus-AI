# VM kapasitesi ve dalga yolu — HBYS kurulum planına göre gözden geçirme

**Tarih:** 2026-11-03 · **Yazan:** Lane A · **Niteliği:** karar belgesi değil; sahibin kararı için plan. Sahibin sözü
(03.11): «bunun planını kuralım; Lane C üzerinde HBYS kurulumu konusunu konuştuk, ona göre gözden geçir».
**Karşılaştırılan kaynak:** HBS birleştirme mimarisi planı (`~/.claude/plans/…c-radiant-music.md`, 25.10.2026, Azerbaycanca:
14 onaylı karar, §B proses topolojisi, §G kurulum paketi, §G2 S/M/L ölçülendirme, «Homunculus üzərində görüləcək işlər» H0–H3)
ve HBYS ayrıştırma kararları (02.11, `/c/tmp/homunculus-plans/hbys/kararlar.md`: H1 kişi kaydı → H7).
Hasta adı, numarası, değeri yoktur; yalnız sayılar ve sistem adları.

> **Numaralama uyarısı.** İki «H1» var: mimari planın **H1 = runtime stabilizasyonu** (Redis, worker, ingest ayrımı) ve
> ayrıştırma kararlarının **H1 = kişi kaydı**. Bu belgede ilki «**M-H1**» (mimari), ikincisi «**K-H1**» (kayıt) diye anılır.

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

**VM'nin bugünkü durumu:** kod 3e0f2b0; api 6a981248 / web d71ce62f (dalga2 imajları); `INFINITY_WAVES=on`; hub R8
transport-3473891380ecc72e + 97-dalga.conf; `:pre-dalga2` = G3'ün imajları (508d1802 / b9a4cbb1); alembic 0015; köprü, nce dokunulmadı.

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
| **1. VM'i büyütmek** (4 vCPU, hızlı/ayrı disk) | Plan M kademesi için **ayrı APP ve DB VM'leri** ister; bugünkü .72 planın öncülüne (bize ait, adanmış VM) uymuyor: MicroK8s + MySQL ile paylaşımlı, 24 GB disk. | **Gerekli ama tek başına yetmez.** Sahibin «CPU ekleyeceğim» kararı CPU paylaşımını azaltır; D-0'ın imzası ve sabah penceresi **disk**. CPU ile birlikte **ayrı/hızlı bir disk** (postgres + hub kaydı) olmadan diz noktasına yine değilir. |
| **2. Hub kaydının commit maliyeti** | Planda hub = edge ajanı, **EDGE VM'de**, kendi diskinde; APP/DB diskini paylaşmaz. Araştırma yolu (`clinical forwarding DISABLED`). | **Küçük, bağımsız, bugün de yarın da geçerli.** Commit başına 22–43 ms olan kaydın `synchronous` düzeyi / toplu commit'i: tıbbi yolu etkilemez. Yerel bench + VM'de commit_ms ile doğrulanır. |
| **3. Panel sorgusunun 9 yetki deyimi** | Plan M-H1(a)'da **kapsam çözümü Redis'te 30 sn önbellek** ve api 2×2 işçi diyor; Redis henüz VM'de yok. | **İki adımlı.** Önce (b): `resolve_scope`'un 8 deyimini birleştirmek — anlam değişmez, her JWT yolu kazanır, Redis'siz. Sonra M-H1(a) ile 30 sn Redis önbelleği (planın kararı; yetki geri alma penceresi 30 sn — uygulamada bir kez daha teyit). |

Planın görmediği, ölçülen üçüncü neden: **api tek işçi** (A-29: motor api içinde) ve motor HTTP ile aynı proseste. Panel sorguları,
13 monitörün POST'larını alan hub ve motoru koşturan api ile aynı iki çekirdeği paylaşıyor. Planın M-H1(c)'si (ingest ayrı, motor
`clinical-worker`'da) tam bunu çözer; dalga panelinin kalıcı yeri orasıdır.

## 4. Önerilen yol

**Faz 0 — VM (sahip + hastane BT; kod yok).** Sahibin «CPU» kararına ek:
1. **CPU:** ≥ 4 vCPU (planın S kademesi 8; pilot için 4 başlangıç). VM yeniden başlar; hub ömrü sıfırlanır, taban yeniden alınır.
2. **Disk:** postgres + hub kaydı için **ayrı bir SSD disk** (ya da hızlı datastore); kök disk 24 GB/%86 derlemeler için bile dar
   (P-0 ile 0,7 GB kazanıldı). En az 100 GB.
3. **Komşular:** .72'deki MicroK8s + mysqld kime ait, taşınır mı — hastane BT'ye soru. Plan sahamızın adanmış VM olmasını
   varsayıyor; değilse ölçümler komşuların yüküne bağlı kalır (D-0 koşu 1 ↔ 2 farkı; sabah %5,81).
4. **Hedef:** M kademesi (APP 12/32 + DB 8/32/1 TB) yeni VM'lerde = planın kurulum sırası (3–5 iş günü). Pilotun «büyütülmüş
   .72»den «planın sahası»na geçişi; zamanı sahibin.

**Faz 1 — küçük kod dilimi «dalga-perf-2» (Lane B; VM'e tek dağıtım kuralıyla).**
1. `resolve_scope` 8 → ≈2 deyim (3b): anlam değişmez; `test_api_scope` + yetki tabloları testleri; ölçüm: api CPU/poll.
2. Hub kaydı commit maliyeti (2): `synchronous` düzeyi ve/veya toplu commit, yalnız araştırma kaydı; bench'te commit_ms, VM'de
   B-2/D-0'da commit_ms satırı.
3. hubdurum: D-0 geçerlilik tabanı ≈150 okuma/180 sn (1 panel ≈1,0/sn); yeniden başlatma sonrası yeni taban kuralı; `refused`
   sayacı kayda.
4. Çıkış ölçütü aynı: mutlak sınırlar (paket ≤ 60 ms, >500 ≤ %3, >1000 ≤ %2, çözücü sağlıklı, PSI cpu ≤ %35) + sabit taban.

**Faz 2 — M-H1 runtime stabilizasyonu (planın kendi işi; dalganın kalıcı yeri).**
M-H1(a) Redis + worker-jobs + api 2×2 + kapsam önbelleği 30 sn + eskalasyon döngüsü worker'a; M-H1(c) ingest/motor ayrımı.
Her biri ayrı VM dağıtımı + geri dönüş. **Bu iş ayrıştırma sırasında (K-H1 → K-H7) yer almıyor**; sahibin sıraya koyması
gerekir (öneri: K-H1 kişi kaydı ile paralel hat; dalga ve ekran sayısı artmadan, K-H5 ayaktan ekranlarından önce).

**Dalga paneli bu arada:** sahibin kararıyla **açık** (02.11 22:01Z). Faz 0.1 + 0.2 sonrası yeni taban + D-0/D-2. Disk değişmeden
sınır aşımı yinelenir (sabah %5,81 panelsiz). Alarm yolu ve kartlar etkilenmez (3 sn sınırı %100); bedel şeridin tazeliği ve
geç çözülen dalga blokları (yalnız görüntü).

## 5. Sahibin kararları

1. **Faz 0 kapsamı:** yalnız CPU mu, CPU + ayrı SSD disk mi? (**Öneri:** ikisi birlikte; disk imzası iki kez ölçüldü.)
2. **.72'nin komşuları:** MicroK8s/mysqld taşınır mı, .72 kalıcı pilot sunucu mu? (BT'ye soru; cevaba göre M kademesi takvimi.)
3. **M kademesi yeni VM'ler:** ne zaman? (Planın 3–5 günlük kurulumu; G3/B1d/dalga blokları yeni sahaya uyarlanır.)
4. **R6 karşılaştırma penceresi** (sabah %5,81'in R8'e mi VM'e mi ait olduğunu ayırmak için gündüz iki hub yeniden başlatması):
   şimdi mi, CPU/disk değişikliğinden sonra mı? (**Öneri:** sonra; yeni taban zaten alınacak, iki gündüz kesintisi boşa gider.)
5. **Faz 1'in sırası:** dalga-perf-2 (3b + 2 + hubdurum) şimdi, Lane B'de — onay?
6. **M-H1 runtime stabilizasyonu** ayrıştırma sırasına nereye girer? (**Öneri:** K-H1 ile paralel, K-H5'ten önce.)
7. **Kapsam önbelleği 30 sn** (planın M-H1(a) kararı): yetki geri alma penceresi 30 sn — teyit.

## 6. Açık gerçekler
- .72'nin sahibi/amacı ve komşu iş yükleri (BT).
- vCPU değişikliği VM'i yeniden başlatır; hub ömrü ve R6/R8 tabanı sıfırlanır; A-3 tarzı taban yeniden alınır.
- `waves.refused` +332 (iki D-0 koşusu arasında, 21:52–21:55Z) ve gece +1542 — Lane B kayda bakacak.
- Bu belge karar üretmez; kararlar roadmap'e ve ilgili spec'lere yazılır.
