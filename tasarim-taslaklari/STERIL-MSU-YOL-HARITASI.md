# Sterilizasyon (MSÜ / CSSD) modülü — yol haritası · 25.10.2026

Kaynak: Sterisys.com.tr + 10+ kaynak araştırması (Getinge T-DOC, STERIS SPM, Censis CensiTrac, TrayPilot, Microsystems/Aesculap; AAMI ST79 akışı; SPD tekniker ağrı noktaları). Hepsi **tasarım/demo** için — gerçek donanım (barkod/otoklav/BI) ayrı ekip; prototipte tıkla/kod-gir ile canlandırılır.

## Standart CSSD akışı (tek yön: kirli → temiz)
Kullanım yeri ön temizlik → Dekontaminasyon (yıkama/WD) → Muayene & test → Montaj (sayım föyü) → Paketleme → Sterilizasyon (yük) → Soğutma/serbest bırakma → Steril depo → Vaka arabası/dağıtım → Kullanım+iade.

## Yapıldı
- [x] 6 aşamalı akış panosu (Kirli Kabul→Yıkama→Paketleme→Sterilizasyon→Steril Depo→Teslim); her adımda kim+zaman.
- [x] Set şablonu + **sayım föyü** (parça listesi); paketlemede eksik parça → set ilerlemez.
- [x] Sterilizasyon: otoklav + döngü + **Bowie-Dick/biyolojik test**; test keçmədi → serbest bırakılmaz (kalite kapısı).
- [x] Steril depo: raf + son kullanım + **FIFO/30 gün** uyarısı.
- [x] Teslim: vaka/ameliyat (ameliyat isteminden seç/serbest) + teslim alan.
- [x] Komuta merkezi (aşama sayıları, sorunlu/uyarılı setler) + ortak liste filtresi.
- [x] **v2:** kullanım/döngü sayısı + ömür uyarısı; **kayıp (Lost)** statüsü + bulundu; **etiket yazdır** + **izlenebilirlik raporu**; **ACİL (STAT)** önceliği (üste sıralanır, kırmızı).
- [x] **v3:** **Yük (load) kavramı** — sterilizasyonda birden çok set tek döngüye (yüke) alınır (gerçek akış); "Yükler" sekmesi. **Recall-by-load (yük geri çağırma)** — testi başarısız/BI şüpheli yük → içindeki tüm setler + ulaştıkları vakalar listelenir, "Geri çağır" ile hepsi yeniden işleme (Kirli Kabul) alınır; rapor yazdırılır.
- [x] **v4 — HBYS/hasta bağı (bizim avantajımız):** **Vaka arabası (case cart)** + "Vaka arabaları" sekmesi. Ameliyat programı HBYS'deki ameliyat istemlerinden gelir (hasta+ameliyat); araba steril depodan set toplar; "Ameliyathaneye gönder" → setler **gerçek hastaya** teslim edilir. Teslim serbest metin değil, **programdan hasta/ameliyat** seçilir (`set.pid`). Böylece izlenebilirlik ve geri çağırma **gerçek hastaya** kadar iner (standalone sistemlerde olmayan hastane değeri). **Yeni şablon formu** elden geçirildi: bölüm açılır liste, satır satır parça ekle/sil, **maks. kullanım döngüsü (ömür)** alanı. Modül üst görünümü düzenlendi; arama kutusu artık panoyu da süzer.

- [x] **v5:** **Tamir/bakım statüsü** (set "Bakıma al" → dolaşım dışı, badge/uyarı, geri al); **Loaner/konsinye set** (yeni sette işaret + firma adı, badge, "önce tüm akıştan geçmeli" uyarısı); **KPI** (komuta merkezinde teslim edilen set, toplam yük, aktif araba, bakımda/loaner sayıları); **araba/teslim kilidi** (arabaya ayrılan set depoda tekil teslim edilemez, "arabada" rozeti).

## Kalan (araştırma önceliğiyle) — öneri sırası
Zorluk: K=kolay, O=orta.
2. [ ] **Vaka arabası (case cart) + OR programı** — O. Ameliyat programından gerekli setlerin toplama listesi; arabayı hazırla, eksik seti işaretle. MSÜ'yü ameliyathaneye bağlar.
3. [ ] **Tamir/bakım statüsü** — O. Bozuk alet/seti "tamirde" işaretle, dolaşımdan çıkar, dönünce geri al.
4. [ ] **Loaner/konsinye set girişi** — O. Firma setini kaydet, kullanımdan önce zorunlu yeniden-işlemden geçir.
5. [ ] **Alet seviyesinde takip (tekil ID)** — O. Sadece set değil, tek tek alet (lazer kod) izleme; UDI uyumu.
6. [ ] **Kusur/defekt kaydı (foto)** — K/O. Set/alete defekt kaydı + görsel (foto yükleme zor; şimdilik notla).
7. [ ] **Instrument-not-found / konum arama** — K. Set/alet no ile ara, anlık aşama/konum göster (filtre kısmen yapıyor).
8. [ ] **KPI/işlem istatistikleri** — K. Teknikerin montaj sayısı, ortalama devir süresi (zaman damgalarından).
9. [ ] **Parametrik serbest bırakma anahtarı** — K. BI beklemeden parametreyle serbest bırakma (doğrulanmış yerlerde).

## Not
Yük + recall yapıldı. Sıradaki en değerli büyük adım: **vaka arabası (case cart) + ameliyat programı** (madde 2) — MSÜ'yü ameliyathaneye bağlar. Sonra tamir/bakım, loaner, alet-ID, KPI.
