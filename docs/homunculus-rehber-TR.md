# Homunculus — Anlaşılır Rehber ve Sözlük (TR)

> **Bu dosya senin için.** Projedeki her tıbbi ve teknik terimi sade dille açıklar. Amaç: kod veya kılavuz okumadan, projenin *ne* yaptığını,
> *neyin hazır* olduğunu ve *neyin eksik* olduğunu anlaman.
>
> **Canlı dosyadır.** Proje ilerledikçe içine yeni terimler, anlamları ve "bunu neden
> kullanmıyoruz" notları eklenir. Bir şeyi anlamadıysan, o terim büyük ihtimalle aşağıdaki
> **Sözlük**'te vardır; yoksa eklenmesi gereken bir boşluktur.
>
> Tıbbi bilgilerin hepsi `Homunculus/` bilgi vault'undaki kaynaklı makalelerden gelir —
> burada sadece sadeleştirilmiştir. Kesin/kaynaklı hâli için vault'a bak.

---

## 1. Homunculus 30 saniyede

Yoğun bakımdaki (ICU) bir hastanın başında onlarca cihaz vardır: kalp ritmi, tansiyon,
oksijen, solunum cihazı… Her biri bir sayı gösterir ve sayı sınırı aşınca **alarm** çalar.

Sorun şu: **kötüleşme, alarm çalmadan saatler önce başlar.** Sayılar hâlâ "normal
sınırlar içinde" görünürken hasta sessizce kötüye gidiyor olabilir. Yorgun bir doktor veya
hemşire bu yavaş gidişi kaçırabilir.

**Homunculus, hastayı 7/24 izleyen akıllı bir nöbetçi asistandır.** Tek tek sayılara değil,
sayıların *birlikte nasıl hareket ettiğine* ve *zaman içindeki eğilimine* bakar. Bir tehlike
örüntüsü görürse doktora **gerekçesiyle birlikte** haber verir:

> *"Bu hastada septik şok kriterleri karşılanıyor. Kanıt: laktat yükseliyor, tansiyonu
> ayakta tutmak için giderek artan ilaç gerekiyor. Kılavuz (SSC 2026) şunu öneriyor…
> Kararı sen ver."*

**İki altın kural** (projenin anayasası):
1. **Homunculus asla emir vermez.** "Şu ilacı ver" demez; "şunu *değerlendir*, çünkü…" der.
   Kararı her zaman doktor verir.
2. **Homunculus tanı koymaz.** "Hastada sepsis var" demez; "sepsis *kriterleri karşılanıyor*"
   der. Fark önemli — ilki iddia, ikincisi gözlem.

---

## 2. "Tam çalışır" ne demek? — Merdiven

Projenin bir anda bitmesi mümkün değil; **basamak basamak** ilerliyor. Şu an neredeyiz:

| Aşama | Ne demek | Durum |
|---|---|---|
| **1. Bilgi vault'u** | Klinik bilgiyi kaynaklarıyla toplayan "ikinci beyin" (Obsidian) | ✅ Kuruldu (sepsis konusu) |
| **2. Görünmez motor** | Cihaz verisini alıp, kuralları işletip, gerekçeli uyarı üreten çekirdek. Ekranı yok; sentetik (uydurma) hasta senaryolarıyla test edilir | ✅ Bitti — 54 test geçiyor |
| **3. Canlı panel** | Doktorun/hemşirenin gerçek zamanlı gördüğü ekran + onay + eskalasyon | 🟡 Büyük kısmı bitti — canlı pano (B1) + onay/eskalasyon (B2) çalışıyor; bildirim kanalları (B3) kaldı |
| **4. Gerçek cihaz + ML** | Gerçek hastane cihazlarına bağlanmak ve öğrenen bir ML modeli eklemek | ML ilk dilimi ✅; cihaz köprüsü (NCE dosya rotası) ✅ yazıldı ve test edildi — sahada devreye alma (paylaşım + alan tablosu) 🔜; ventilatör köprüsü (MEDIBUS, `medibus/`) ✅ yazıldı, USB'den tek cihazda denenecek |

**Şu anki dürüst tablo:** Beyin (vault) ve kalp (motor) çalışıyor. Motor, uydurma bir
hastayı saat saat kötüleştirip doğru uyarıyı doğru anda ürettiğini kanıtlıyor. Gözü de var:
canlı panel (3. basamak) çalışıyor, ve yeni tasarımdaki arayüzü Grup 1'de yazılıyor — yataklar,
alarmlar, hasta ekranı ve yönetim ekranı hazır (aşağıda 3.5 ve 3.6); Grup 1 ile Aşama A, 19 Ekim
2026'da hastanenin sunucusunda canlıya alındı (yapı a2c1257c). Gerçek cihaz bağlantısının durumu
4. basamakta.

### "Tam çalışır" için daha neler gerekli?

| Gereken parça | Ne işe yarar | Neden henüz yok |
|---|---|---|
| **NEWS2** (bkz. Sözlük) | Laboratuvar beklemeden, sadece hayati bulgularla "bu hasta kötüleşiyor mu?" taraması | ✅ Vault'ta **ve** motorda (kural, Ölçek 1) |
| **Hastaya-göreli / komorbidite katmanı** | Alarmı hastanın *kendi* bazaline göre değerlendir: kronik-normali bastır, akut değişimi öne çıkar | ✅ Kuruldu (klinisyen profili + indirge/akut-değişim) |
| **Canlı panel (React)** | Doktor/hemşire görünümü, hasta listesi, canlı grafikler, uyarı geçmişi | Plan B; motor önce bitmesi gerekiyordu |
| **Bildirim + eskalasyon** | Uyarıyı doktora iletmek; 20 dk cevap yoksa başka birine yükseltmek | ✅ Uygulama-içi/tarayıcı bildirimi kuruldu (toast + masaüstü + ses, role göre); e-posta/SMS 🔜 |
| **Denetim kaydı (audit)** | Her uyarı/öneri/onayın değişmez kaydı — güven ve hukuk için | ✅ İlk dilim kuruldu (SQLite, ekle-sadece trigger'lı, `/audit`); gerçek Postgres 🔜 |
| **Gerçek cihaz entegrasyonu** | Ventilatör, monitör, pompa verisini gerçek hastaneden almak | Cihaz erişimi + etik/hukuk onayı gerektirir |
| **ML modeli (erken sepsis)** | Veriden öğrenerek kural ateşlenmeden *önce* erken uyarı | ✅ İlk dilim kuruldu (PhysioNet 2019, gradient-boosted ağaçlar); motora `sepsis_watch` ek-sinyali |

---

## 3. Sözlük

Her terim şu düzende: **Ne demek (basit)** → **Tıbbi anlamı** → **Homunculus'ta** →
(varsa) **Neden kullanmıyoruz**. Terimin İngilizce/orijinal adı korunur (kaynaklarla uyum
için), anlamı Türkçe anlatılır.

### 3.1 Temel klinik kavramlar

**Sepsis**
- *Basit:* Vücudun bir enfeksiyona karşı verdiği savunmanın kontrolden çıkıp kendi
  organlarına zarar vermeye başlaması. Tehlike mikroptan çok, vücudun **aşırı tepkisidir**.
- *Tıbbi:* "Enfeksiyona karşı düzensiz konak yanıtının yol açtığı, hayatı tehdit eden organ
  disfonksiyonu" (Sepsis-3 tanımı). Ölçütü: şüpheli enfeksiyon + **SOFA** skorunda ani ≥2
  puanlık artış.
- *Homunculus'ta:* Sistem "sepsis var" demez; organ disfonksiyonu kötüleşiyorsa ve enfeksiyon
  şüphesi varsa "Sepsis-3 eşiği karşılanıyor" der.

**Septik şok**
- *Basit:* Sepsisin en ağır hâli. Vücut hem tansiyonu ayakta tutamıyor **hem de** hücreler
  oksijeni kullanamıyor. En ölümcül aşama.
- *Tıbbi:* Sepsis + **ikisi birden**: (1) MAP ≥65 mmHg için vazopresör gerekmesi, (2) yeterli
  sıvıya rağmen laktat >2 mmol/L. Hastane ölümü **>%40**.
- *Homunculus'ta:* Bu iki sinyali **birlikte** değerlendirir (ayrı ayrı iki alarm değil, tek
  akıllı uyarı). Neden birlikte? Çünkü rakamlar öyle diyor:

  | Durum | Ölüm oranı |
  |---|---|
  | Tek başına yüksek laktat | %25.7 |
  | Tek başına vazopresör gereken düşük tansiyon | %30.1 |
  | **İkisi birden (septik şok)** | **%42.3** |

  İkisinin birleşimi, parçaların toplamından daha kötü bir hastayı işaret eder.

**Organ disfonksiyonu**
- *Basit:* Bir organın (böbrek, karaciğer, akciğer, kalp…) işini gerektiği gibi yapamaması.
- *Tıbbi:* Sepsis tanımının kalbi. **SOFA** skoru tam olarak bunu ölçer.

**Perfüzyon**
- *Basit:* Kanın dokulara yeterince ulaşıp oksijen götürmesi. "İyi perfüzyon" = doku besleniyor.
- *Tıbbi:* Yetersiz perfüzyon (hipoperfüzyon) şokun temelidir; laktat yükselmesi bunun işareti.

**Laktat (lactate)**
- *Basit:* Hücreler oksijensiz kalınca ürettiği bir "atık". Kanda çok laktat = hücreler
  boğuluyor demektir. Bir nevi vücudun "yardım" çığlığı.
- *Tıbbi:* >2 mmol/L septik şok ölçütünün metabolik yarısı. Yükselmesi kötü, düşmesi iyi gidiş.
- *Homunculus'ta:* Laktat **sadece biri kan aldığında** ölçülür (sürekli değil). Bu yüzden en
  değerli önerilerden biri "laktatı tekrar ölç" olur — çünkü sistem o an bu eksende **kör**dür.
- *Not:* Yüksek laktat her zaman sepsis değildir (nöbet, egzersiz, bazı ilaçlar da yükseltir);
  bağlamla yorumlanmalı.

**MAP (Mean Arterial Pressure — Ortalama Arter Basıncı)**
- *Basit:* Tansiyonun tek bir "ortalama" sayısı. Organların beslenmesi için yeterince yüksek
  olması gerekir.
- *Tıbbi:* Sepsiste hedef **≥65 mmHg** (65 yaş üstünde 60–65). Bunu tutmak için ilaç
  (vazopresör) gerekiyorsa, bu ciddi bir uyarı işaretidir.

**Vazopresör (vasopressor)**
- *Basit:* Damarları sıkıp tansiyonu yükselten ilaç (örn. norepinefrin). Tansiyon kendi başına
  yetmiyorsa devreye girer.
- *Tıbbi:* Septik şokta ilk tercih **norepinefrin** (SSC 2026, güçlü öneri).
- *Homunculus'ta:* İlaç dozunun **sürekli artırılması** başlı başına bir kötüleşme sinyalidir —
  ve hiçbir klasik alarm bunu yakalamaz, çünkü her an tansiyon "normal sınırda" görünür.

**Resüsitasyon / sıvı resüsitasyonu (resuscitation)**
- *Basit:* Hastayı toparlamak için yapılan acil müdahale; sepsiste genelde damardan bol sıvı
  vermek.
- *Tıbbi:* SSC 2026: ilk 3 saatte **≥30 mL/kg kristaloid**. "Yeterli sıvı verildi mi?" sorusu,
  septik şoku *yetersiz sıvı almış* sepsisten ayıran kritik farktır.

**Kristaloid (crystalloid)**
- *Basit:* Damardan verilen tuzlu/dengeli su tipi sıvı (serum). Sıvı resüsitasyonunun ana aracı.

**Under-resuscitation (yetersiz resüsitasyon)**
- *Basit:* Hastaya henüz *yeterince sıvı verilmemiş* olması. Bu durumda düşük tansiyon + yüksek
  laktat, şok değil **susuzluk** olabilir — ve çözüm tam tersidir (ilaç değil, sıvı).
- *Homunculus'ta:* Motor bu ayrımı yapar: yeterli sıvı verilmediyse "septik şok" demez, "sıvı
  yanıtını değerlendir" önerisi verir. Bu yüzden **sıvı pompası verisi** doğruluk için şarttır.

---

### 3.2 Skorlar (puanlama sistemleri)

**SOFA (Sequential Organ Failure Assessment)**
- *Basit:* Altı organ sistemine 0–4 arası "hasar puanı" veren bir karne. Toplam ne kadar
  yüksekse, hasta o kadar kötü. Sepsis tanısının cetveli.
- *Tıbbi:* Solunum, pıhtılaşma, karaciğer, dolaşım, beyin (bilinç), böbrek — her biri 0–4
  (toplam 24). Şüpheli enfeksiyonda **ani ≥2 puan artış = sepsis**.
- *Homunculus'ta:* Motor SOFA'yı sürekli hesaplar. **Önemli incelik:** SOFA'nın bazı parçaları
  (laktat değil ama kreatinin, bilirubin, trombosit…) laboratuvar ister; bunlar sadece kan
  alındığında güncellenir. Yani SOFA "sıçraya sıçraya" güncellenir — bkz. **bayatlık**.
- *Bayatlık-farkında (B6, kuruldu):* Motor artık bir SOFA girdisi tazelik penceresinden eski
  kalınca (ör. kreatinin ~26 saatten eski) bunu **işaretler** — sepsis uyarısının gerekçesine
  "veri tazeliği" notu düşer, en eski girdiyi adlandırır. **Eşikler değişmez** (hâlâ sepsis-3);
  pencereler operasyonel varsayılan, klinik iddia değil; eski değer **gizlenmez, açıkça belirtilir**.

**NEWS2 (National Early Warning Score 2)**
- *Basit:* "Bu hasta genel olarak kötüleşiyor mu?" sorusuna, **hiç laboratuvar beklemeden**,
  sadece hayati bulgularla (solunum, oksijen, tansiyon, nabız, bilinç, ateş) cevap veren erken
  uyarı skoru.
- *Tıbbi:* Güncel kılavuz (SSC 2026) hastane sepsis **taraması** için NEWS2/NEWS/MEWS/SIRS'i
  **qSOFA yerine** öneriyor (güçlü öneri).
- *Homunculus'ta:* **Vault'ta *ve* artık motorda çalışıyor** (bir `rules/` kuralı olarak, Ölçek 1).
  Neden bu kadar değerli? Çünkü tamamen sürekli-gelen sinyallerden hesaplanır — laboratuvar
  gerektirmez, motorun zaten aldığı veriyle *hemen* çalışır. Sıfır ML, sıfır veri seti ile kılavuza
  uygun bir çıktı. Motor tek bir "news2" uyarısı üretir, banda göre aciliyet (≥7 anında, 5-6 yakında)
  ve tek-parametre-3 kuralı dahil; eksik vital olduğunda skoru "kısmi" diye dürüstçe işaretler.
  *(Ölçek 2 — hiperkapnik — kaynaklarda çözülmemiş bir hücre içerdiği için bilinçli olarak dışarıda:
  uydurma eşik koymayız.)*
- **Neden KULLANMIYORUZ (tek başına):** NEWS2 **popülasyon-eşiği** temellidir — herkese aynı bantı
  uygular, hastanın *kendi normalini* ve yandaş tanılarını dikkate almaz. Kronik atriyal
  fibrilasyonlu, nabzı normalde 100-110 olan bir hasta her ölçümde puan alır; tansiyonu normalde
  yüksek olan bir hasta, kendisi için tehlikeli bir düşüşte "iyi" görünür. Kronik-normal değerlere
  alarm çalmak, tam da klinisyenin görmezden gelmeyi öğrendiği gürültüdür. Bu yüzden NEWS2'nin
  üstüne bir **hastaya-göreli / komorbidite-farkındalıklı katman** gerekir (aşağıdaki köşeye bakın).
  — bu, sizin ilettiğiniz doktor görüşünün ta kendisi.

**qSOFA (quick SOFA)**
- *Basit:* Üç maddelik hızlı kontrol: solunum ≥22, tansiyon (üst) ≤100, bilinç bulanık. İkisi
  varsa "dikkat" der.
- **Neden KULLANMIYORUZ (tarama için):** qSOFA **hasta olanları kaçırıyor** — orijinal
  çalışmada duyarlılığı sadece **%24** (yani 4 hastadan 3'ünü ıskalıyor). Bir tarama aracının
  görevi *kimseyi kaçırmamaktır*; qSOFA bunu yapamıyor. Kılavuz 2021'de "qSOFA'yı tek tarama
  aracı olarak kullanma" dedi, 2026'da bunu daha da sertleştirdi. **Ders:** iyi bir araç bile
  yanlış işe koşulursa başarısız olur. Bu, tüm projenin en önemli derslerinden biri.

**Phoenix kriterleri (2024)**
- *Basit:* Çocuklar (0–18 yaş) için sepsis tanımı. Yetişkin Sepsis-3'ün çocuk versiyonu.
- *Önemli:* Prematüre bebekleri ve yenidoğanları **açıkça dışlar** — yani NICU'yu kapsamaz.

**nSOFA (neonatal SOFA)**
- *Basit:* Yenidoğanlar için organ hasarı skoru. Üç sisteme bakar.
- *Önemli:* **Tanı değil, gidişat (prognoz) aracıdır.** "Ne kadar kötü ve hangi yöne gidiyor"
  sorusunu yanıtlar; "sepsis mi başlıyor" sorusunu değil.

**Neden NICU (yenidoğan yoğun bakımı) ayrı bir dünya:** Yenidoğanlar için **üzerinde
uzlaşılmış bir sepsis tanımı yok**. Yetişkin (Sepsis-3) ve çocuk (Phoenix) tanımlarının ikisi
de NICU'yu dışarıda bırakır. Ayrıca belirtiler ters: yenidoğanda ateş yerine **hipotermi**,
erken **bradikardi** (yavaş nabız), ve düşük tansiyon *geç* gelir. Bu yüzden NICU, ICU
modelinin bir ayarı değil, **ayrı bir üründür**.

---

### 3.3 Ölçümler ve sinyaller

| Terim | Basit anlamı | Nasıl gelir |
|---|---|---|
| **Heart rate (kalp hızı)** | Kalbin dakikadaki atış sayısı | Monitörden, sürekli |
| **Respiratory rate (solunum hızı)** | Dakikadaki nefes sayısı | Monitörden, sürekli |
| **SpO₂** | Kandaki oksijen doygunluğu (%) — parmak klipsi ölçer | Sürekli |
| **FiO₂** | Hastaya verilen havadaki oksijen oranı (oda havası %21) | Ventilatörden, sürekli |
| **PaO₂/FiO₂** | Akciğerin oksijeni kana ne kadar iyi geçirdiğini gösteren oran | Kan gazı ister (aralıklı) |
| **Platelets (trombosit)** | Pıhtılaşmayı sağlayan kan hücreleri; düşerse kanama riski | Laboratuvardan (aralıklı) |
| **Bilirubin** | Karaciğer atığı; yükselirse karaciğer zorlanıyor | Laboratuvardan (aralıklı) |
| **Creatinine (kreatinin)** | Böbrek atığı; yükselirse böbrek zorlanıyor | Laboratuvardan (aralıklı) |
| **GCS (Glasgow Koma Skalası)** | Bilinç düzeyi puanı (15 tam uyanık, düşükçe kötü) | Hemşire değerlendirir |
| **Urine output (idrar çıkışı)** | Saatlik idrar miktarı; azalması böbrek/perfüzyon sorunu | Hemşire kaydeder |
| **End-tidal CO₂ / kapnografi** | Nefeste dışarı verilen CO₂ — solunumun kalitesini gösterir | Cihazdan, sürekli |

**Neden bu ayrım (sürekli vs aralıklı) çok önemli:** Homunculus'un tüm fikri şu — **sürekli
gelen sinyaller (kalp, solunum, tansiyon), laboratuvar sonuçlarından önce hareket eder.** Bir
kötüleşme, laboratuvar bunu yakalayana kadar saatler geçebilirken, sürekli sinyallerin
*eğiliminde ve dokusunda* çoktan görünür olur. Sistem bu "erken pencereyi" kullanır.

---

### 3.4 Teknik ve ürün kavramları

**FHIR / HL7**
- *Basit:* Hastane cihazlarının ve sistemlerinin birbirleriyle konuştuğu ortak "diller"
  (standart mesaj formatları). Farklı marka cihazların aynı dilde veri göndermesini sağlar.
- *Homunculus'ta:* Simülatör, uydurma hasta verisini gerçek hastane formatında (FHIR
  Observation) yayınlar — böylece ileride gerçek cihaz aynı kapıya takılır.

**Gateway (geçit)**
- *Basit:* Dışarıdan gelen mesajları alıp, içeride herkesin anladığı tek bir ortak biçime
  çeviren "gümrük kapısı". Bozuk mesajı reddeder, akışı çökertmez.

**WACP**
- *Basit:* Bazı üreticilerin (bizde Welch Allyn) kendi cihazlarıyla konuşmak için kullandığı,
  dokümantasyonu dışarıya kapalı "özel dil". HL7 gibi ortak bir standart değildir.
- *Homunculus'ta:* Pilot monitör (Connex Spot) HL7 değil WACP konuşuyor. Bunu keşif aracımız,
  cihazın gönderdiği 37 baytın içindeki `RNDZCONNECT` selamından anladı — cihaz karşısında
  üreticinin kendi sunucusunu arıyordu.

**NCE (Network Connectivity Engine)**
- *Basit:* Welch Allyn'in, cihazlarından WACP ile veri toplayan kendi sunucu yazılımı.
- *Homunculus'ta:* Hastanede 2020'den beri çalışan bir NCE sunucusu bulundu; monitörler ona
  bağlı ve her ölçüm oturumunu diske XML dosyası olarak yazıyor. Entegrasyon noktamız bu:
  cihazla biz değil NCE konuşuyor, biz NCE'nin yazdığı dosyaları **salt-okunur** okuyoruz.

**Keşif modu (discovery)**
- *Basit:* Eşleme tablosunu yazmadan önce köprüyü "hiçbir şey iletme, sadece gördüğün alan
  adlarını say ve raporla" kipinde çalıştırmak. Rapor `Eşlenmemiş alanlar: SpO2 (12), ...` gibi
  bir satırdır — ölçüm değeri ya da hasta bilgisi asla içermez.
- *Neden:* Satıcının alan adlarını tahmin etmek, pilotun her ekranı sağlıklı görünürken hiç
  veri almamasının klasik yoludur. Yanlış tablo, sessiz bir servisle aynı görünür; sayaçlar bu
  körlüğü görünür kılar.

**Bayatlık (staleness)**
- *Basit:* Bir ölçümün ne kadar "eski" olduğu. 10 dakika önceki laktat ile 4 saat önceki
  laktat aynı şey değildir. Sistem her değerin **yaşını** bilir.
- *Homunculus'ta:* Bir sinyal bayatladıysa, sistem değer uydurmaz — "bu laktat 4 saatlik,
  tekrar ölçmeyi değerlendir" der. Kör olduğu yeri dürüstçe söyler.

**Pipeline (işlem hattı)**
- *Basit:* Verinin baştan sona geçtiği montaj bandı: cihaz → gateway → hasta durumu → kurallar
  → öneri → bildirim → ekran.

**Kural motoru (rule engine)**
- *Basit:* "Eğer şu ve şu olursa, şunu öner" mantığını işleten deterministik beyin. Rastgele
  değil, her kararı vault'taki bir kaynağa dayanır.
- *Neden (şimdilik) ML değil de kural:* Kural motoru **her cümlesini açıklayabilir ve bir
  kaynağa bağlayabilir.** Klinik bir üründe önce güvenilir, açıklanabilir bir omurga gerekir;
  ML sonra bunun *yanına* eklenir, yerine değil.

**No-orders register ("emir vermeme" kaydı)**
- *Basit:* Sistemin ürettiği her önerinin "Değerlendir / Gözden geçir / İzle" gibi kelimelerle
  başlaması, asla "Ver / Uygula / Başlat" gibi emir cümlesi olmaması kuralı. Testlerle zorlanır.
- *Neden:* Homunculus emir veren bir cihaz olursa hem projenin anayasasını çiğner hem de
  hukuken "tıbbi cihaz" hâline gelir. Karar hep doktorundur.

**GRADE**
- *Basit:* Tıbbi önerilerin gücünü derecelendiren sistem. İki ayrı şey söyler: (1) öneri ne
  kadar *güçlü*, (2) arkasındaki kanıt ne kadar *kesin*.
- *Neden önemli:* Bir öneri "güçlü" ama kanıtı "çok düşük kesinlik" olabilir (örn. sepsiste 1
  saat içinde antibiyotik). Homunculus bu inceliği ekrana taşımalı, tek bir sahte "%95 güven"
  sayısına indirgememeli.

**Alert schema (uyarı şeması)**
- *Basit:* Her uyarının taşıdığı standart bilgi paketi: önem, aciliyet, gerekçe, kanıt, önerilen
  eylem, güven düzeyi.

**Silent mode (sessiz mod)**
- *Basit:* Sistemi gerçek hastada *çalıştırıp ama kimseye göstermeden* çıktısını kaydetmek.
  "Doktor harekete geçmeden kaç saat önce uyarırdı?" sorusunu güvenle (kimseye zarar vermeden)
  ölçmenin yolu. İleride kanıt için en değerli deney.

**Tasarım değişkeni (design token)**
- *Basit:* Ekrandaki her rengin, yazı boyunun ve yazı tipinin tek bir yerde adı konmuş hâli
  (`--card`, `--crit`, `--font-text`). Bileşen "kırmızı" yazmaz, "kritik" der; Gece/Gün teması
  yalnız bu değerleri değiştirir.
- *Homunculus'ta:* Yeni arayüzün değişkenleri `dashboard/src/live/theme/tokens.css`'te,
  prototipin adlarıyla. Tailwind sınıfı adın kendisidir (`bg-card`, `text-crit-ink`).

**Kontrast oranı (WCAG AA)**
- *Basit:* Yazının zemine göre ne kadar okunur olduğu: 1:1 (görünmez) ile 21:1 (beyaz üstünde
  siyah) arası. Normal yazı en az 4,5:1, odak çerçevesi gibi arayüz işaretleri en az 3:1 olmalı.
- *Homunculus'ta:* Bir test her renk çiftini hesaplar. Prototipin Gün temasındaki risk hapları
  2,6–3,9:1'di; bu yüzden risk yazısı ayrı, koyu "mürekkep" renkleriyle yazılır. Gece nöbetinde
  okunamayan bir "kritik" etiketi, hiç olmamasından kötüdür.

**Tasarım galerisi (`?tasarim=1`)**
- *Basit:* Yeni arayüzün bütün renk, yazı, simge ve parçalarını tek sayfada, iki temada ve dört
  dilde gösteren inceleme sayfası. Uygulamadan bağlantı verilmez; adrese elle yazılır.
- *Homunculus'ta:* Varsayılan dil Azerbaycanca'dır (yol haritası D2); seçilen dil, tema ve yazı
  boyu tarayıcıda saklanır. Hasta verisi hiçbir zaman çevrilmez — yalnız arayüz metinleri.
  Çevrimdışı önbellekte tutulmaz (G1-16): ağ yokken açılmaz, servis bilgisayarı onu indirmez.

**Sabit paket sürümleri (`constraints.txt`)**
- *Basit:* Sunucuya kurulan her yazılım paketinin tam sürümünün listesi. Liste olmadan her
  yeniden kurulum o gün çıkmış en yeni sürümü alır; test edilmemiş bir sürüm sistemi
  açılamaz hâle getirebilir.
- *Homunculus'ta:* API imajı Python 3.12 üzerinde, `homunculus-engine/constraints.txt`'teki
  sürümlerle kurulur; liste temiz bir Python 3.12 kurulumundan çıkarılır ve testler bu sürümlere
  karşı koşar. (Liste gelmeden önce SQLAlchemy 2.1, veritabanı katmanının istediği `greenlet`'i
  getirmeden kuruldu ve API açılamadı.) Geliştirme ortamı Python 3.14'tür; arka uç testleri
  iki yorumlayıcıda da koşturulur, çünkü bazı davranışlar sürüme göre değişir (3.12'de bir
  dizin kesintisi bu yüzden 503 yerine 500 veriyordu). 3.14 geliştirme ortamı bu listeyi
  kendiliğinden kullanmaz, başka sürümler kurulu olabilir (ör. SQLAlchemy 2.0.51); listeye
  hizalamak için `homunculus-engine/` içinde: `pip install -c constraints.txt -e ".[dev]"`.

---

### 3.5 Kimlik ve yetki terimleri

Bu bölüm, gerçek sistemde (`?live=1`) kimin neyi yapabildiğini anlatır. Kaynağı tasarım belgesi
(`docs/superpowers/specs/2026-09-23-ldap-rbac-design.md`) ve kod (`homunculus-engine/src/homunculus/auth/`,
`admin/`). Active Directory (LDAP) ile giriş için aşağıdaki "Active Directory ile giriş"
maddesine bakın. Yeni arayüzün yönetim ekranı — kullanıcılar, roller ve yetkiler, giriş kaynağı
(AD) — Dalga 3B'de geldi: aşağıda "Yönetim ekranı". Klinik ekranlar (Yataklar, Alarmlar, Hasta)
Dalga 3'te geldi: 3.6.

**İzin (permission)**
- *Basit:* "Panoyu görebilir", "alarm onaylayabilir", "kullanıcı yönetebilir" gibi tek tek haklar.
- *Homunculus'ta:* 21 sabit anahtar (`board.view`, `alerts.ack`, `users.manage`, `groups.manage`…).
  Liste kodda yaşar (`auth/permissions.py`), çünkü yazılımın *neler yapabildiği* yazılımın
  özelliğidir; bunları *kimin* yapabileceği ise hastanenin kararıdır ve veritabanında, gruplarda
  yaşar. Her API rotası bir izinle korunur. Bir test her rotayı kendi iznine sabitler: izni
  tanımlanmamış yeni bir rota testten geçemez.

**Grup (group)**
- *Basit:* Kullanıcıların konulduğu kutu: Hemşire, Sorumlu Hemşire, Hekim, Sistem Yöneticisi…
  Yönetici yeni kutu açabilir, adını ve içindeki hakları değiştirebilir.
- *Homunculus'ta:* Her grup bir **izin kümesi** ve bir MFA bayrağı taşır. Bir kullanıcının yetkisi,
  üye olduğu grupların izinlerinin **birleşimidir**. Her kurumda 11 varsayılan grup hazır gelir.
  `hospital_admin` (Sistem Yöneticisi) **sistem grubudur**: kural gereği bütün kataloğu taşır
  (sonraki sürümlerin eklediği izinler dahil); hakları ve MFA bayrağı değiştirilemez, kendisi
  silinemez. Üyesi olan bir grup da silinemez.

**RBAC (rol tabanlı erişim denetimi)**
- *Basit:* "Kişiye göre" değil "göreve göre" yetki. Yeni bir hemşire geldiğinde tek tek hak
  vermek yerine Hemşire grubuna eklenir.
- *Homunculus'ta:* Girişte kullanıcının izinleri **token'a yazılır** (`perms`); rotalar izni
  token'dan okur. Her istekte hesabın hâlâ etkin olduğu, kurum üyeliği ve `token_version` sayacı
  kontrol edilir. Yetkisi değişen kullanıcının sayacı artar; eski token reddedilir, panel fark
  ettirmeden yenisini alır ve oturum kapanmaz. Pasifleştirme, parola sıfırlama ve MFA sıfırlama
  ise kullanıcının **bütün oturumlarını** kapatır.
- *Geçiş notu:* Eski sürümün token'larında bu sayaç yok. Yükseltmeden sonra herkes (mobil dahil)
  bir kez yeniden giriş yapar.

**Yönetici (administrator)**
- *Basit:* Kullanıcıları, grupları ve kurum ayarlarını yöneten kişi.
- *Homunculus'ta:* Yönetici = `hospital_admin` grubunun **yerel** üyesi: parolası olan, etkin, kurumda
  etkin üyeliği bulunan yerel bir hesap. Başka gruplar üzerinden bütün izinleri toplamış biri
  yönetici sayılmaz, çünkü özel bir grup yeni sürümün eklediği izni kendiliğinden kazanmaz. Active
  Directory hesapları da sayılmaz: dizin sunucusu çöktüğünde koğuş kendi yönetiminden kilitlenmemeli.
  Sistem son yöneticiyi korur: "Son yönetici pasifleştirilemez", "Son yöneticinin yetkisi
  kaldırılamaz". Her yönetim değişikliği denetim kaydına yazılır (`event_type=admin`: kim, kime,
  önce, sonra); girişler ve MFA adımları `auth` olarak yazılır.
- **Her hastanede en az İKİ yerel yönetici olmalı,** her birinin kendi doğrulayıcı telefonu olmalı.
  Tek yönetici telefonunu kaybederse ya da parolasını unutursa sistem bunu kendi içinden çözemez:
  kimse kendi MFA'sını ya da parolasını yönetici ekranından sıfırlayamaz; ilk kurulum betiği de var
  olan bir hesabın parolasını değiştirmez. O zaman hesabı ikinci yönetici sıfırlar. Son çare:
  `scripts/seed_admin.py` YENİ bir `SEED_ADMIN_EMAIL` ile yeni bir yönetici açar.

**"Kendi yetkinden fazlasını veremezsin" kuralı**
- *Basit:* Kimse elinde olmayan bir anahtarı başkasına veremez.
- *Homunculus'ta:* Yönetim işlemini yapan kişinin hakları, yapabileceklerinin sınırıdır:
  - bir kullanıcıyı düzenlemek, parolasını sıfırlamak ya da gruplarını değiştirmek için o
    kullanıcının hakları sizinkilerin içinde kalmalı;
  - bir grubu vermek, açmak, düzenlemek ya da silmek için grubun hakları (değişiklikten önce ve
    sonra) sizinkilerin içinde kalmalı; `hospital_admin` bütün katalog sayılır;
  - bir grubun haklarını değiştirmek bütün üyelerini değiştirir, bu yüzden aynı kontrol her üye
    için de yapılır.

  Haklarınız token'dan değil, veritabanından okunur. Kuralı aşan istek 403 ile reddedilir. Panel,
  veremeyeceğiniz grubu gri gösterir ve nedenini yazar: "Yetkileriniz bu grubu vermeye yetmiyor."
  Yeni yönetim ekranında böyle bir grup listeden **gizlenmez**; seçilemez ve yanında "Bu grubun
  yetkileri sizinkini aşıyor; veremezsiniz." yazar — kullanıcı formunda da, AD'den içe aktarmanın
  ek grubunda da. "Bu hastanede böyle bir grup yok" ile "bu grubu ben veremem" ayrı iki cevaptır.
- *Kendinize uygulanamayanlar:* Yönetici ekranından kendi parolanızı ya da MFA'nızı sıfırlayamaz,
  kendinizi pasifleştiremezsiniz (409). Kendi parolanız için "Parolamı değiştir" kullanılır.
- *Başka kurumla paylaşılan hesap:* Başka bir kurumda da etkin üyeliği olan bir hesabın ya da bir
  platform operatörünün parolası, MFA'sı, adı, e-postası ve etkinliği bu kurumdan değiştirilemez
  (409); yalnızca bu kurumdaki grupları değiştirilebilir.

**Kullanıcı yöneticisi (user manager)**
- *Basit:* Personeli gruplara yerleştirebilen ama "her şeyin yöneticisi" olmayan kişi. Örnek: kendi
  hemşirelerini Hemşire grubuna ekleyen bir sorumlu hemşire.
- *Homunculus'ta:* `users.manage` izni olan ama bütün kataloğu taşımayan kullanıcı. Grupları
  listeleyebilir, kullanıcı açabilir ve yukarıdaki kural içinde kalan grupları verebilir.
  Varsayılan gruplarda bu izin yalnızca Sistem Yöneticisi'nde vardır; bir yönetici onu yeni bir
  grupla başkasına verebilir. Panel, yönetici simgesini yalnızca bütün kataloğu taşıyana gösterir.
  AD grup eşlemesini okuyabilir ama değiştiremez (aşağıda "AD grup eşlemesi").

**Kiracı (tenant) ve kiracı yalıtımı**
- *Basit:* Kiracı, sistemi kullanan bir kurumdur (hastane). Yalıtım: bir hastanenin kullanıcısı
  başka bir hastanenin hiçbir kaydını göremez, değiştiremez.
- *Homunculus'ta:* Token kullanıcının kurumunu (`tenant`) taşır. Kabul, alarm, break-glass (acil
  erişim oturumu), devir, nöbet ve yapı rotalarının hepsi yalnızca o kurumun kayıtları üzerinde
  çalışır: başka kurumun bir kaydı "yok" gibi yanıtlanır (404), listeler yalnızca kendi kurumu
  gösterir. Token'daki kurum adına tek başına güvenilmez; her istekte kurumun etkin olduğu ve
  kullanıcının orada etkin üyeliği bulunduğu yeniden kontrol edilir.

**Platform operatörü**
- *Basit:* Hastanenin değil, yazılımı sağlayan tarafın (üreticinin) teknik hesabı.
- *Homunculus'ta:* Veritabanında `is_platform_support` bayrağıyla işaretlenir; hiçbir grup bu
  yetkiyi vermez. Yeni bir kurum (kiracı) açabilen tek hesaptır, bunun için de her zaman MFA ile
  doğrulanmış olmalıdır. Bayrak konduktan sonra operatör MFA ile yeniden giriş yapar. Yeni kurumun
  ilk yöneticisi `scripts/seed_admin.py` ile açılır.
- *Karıştırmayın:* "Üretici Destek" grubu (`platform_support`) başka bir şeydir. Yalnızca denetim
  kaydına ve cihaz uç noktalarına erişim verir, kurum açamaz.

**MFA (iki adımlı doğrulama)**
- *Basit:* Paroladan sonra telefondaki doğrulayıcı uygulamasının (Google/Microsoft Authenticator)
  ürettiği 6 haneli kod.
- *Homunculus'ta:* **Grup bazlıdır** (`mfa_required`): kullanıcının gruplarından biri istiyorsa
  gereklidir. Varsayılan olarak Sistem Yöneticisi, Sorumlu Hekim, Ünite Hekimi ve Üretici Destek
  gruplarında açıktır. Kod girilmeden API yalnızca doğrulayıcı kurma ve doğrulama, profil okuma ve
  token yenileme isteklerini kabul eder; başka hiçbir rotaya izin vermez. İlk girişte panel QR kodunu
  ve elle giriş anahtarını gösterir. 5 yanlış kod doğrulamayı 5 dakika kilitler; kullanılmış bir kod
  ikinci kez geçmez. Telefonunu kaybeden kullanıcının MFA'sını bir yönetici sıfırlar. Mobil
  uygulamada henüz kod adımı yok, bu yüzden MFA isteyen bir gruptaki kişi mobili şimdilik kullanamaz.

**"Parolamı değiştir" ve geçici şifre**
- *Basit:* Yöneticinin verdiği şifre geçicidir; kişi ilk girişte kendi şifresini belirler.
- *Homunculus'ta:* Yeni arayüzde Ayarlar › Güvenlik'tedir. Mevcut şifre, yeni şifre ve tekrarı
  istenir; sunucu en az 8 karakter ister ve yeni şifrenin mevcut şifreden farklı olmasını ister.
  Değişiklik diğer bütün oturumları kapatır, bu oturum yeni bir token çiftiyle açık kalır.
  Yönetici yeni bir yerel hesap açtığında ya da şifreyi sıfırladığında sistem bunu **zorlar**
  (`users.must_change_password`): kişi giriş yapınca (MFA'sı varsa önce doğrulama kodunu girer)
  "Yeni şifrə təyin edin" ekranına düşer; şifresini değiştirene kadar API bütün diğer isteklere
  403 `password_change_required` der. Mobil uygulama böyle bir hesabı içeri almaz, "önce panodan
  girip şifrenizi belirleyin" der. **Güncellemeyle gelen göç (`0011`), o gün var olan bütün yerel
  hesapları işaretler** (tohum yönetici dahil): yerel hesabı olan herkes güncellemeden sonraki ilk
  girişte bir kez kendi şifresini belirler — "mevcut şifre" bugünkü şifresidir; kullanıcılara
  önceden duyurulur. Yanlış "mevcut şifre" de kilit ekranındaki yanlış şifreyle birlikte sayılır:
  beşinde ikisi de 15 dakika kapanır (doğru bir giriş ya da yöneticinin şifre sıfırlaması sayacı
  sıfırlar). Aynı formu iki kez göndermek ikinci isteğe "oturum eskidi" yanıtı getirir; düğme
  istek sürerken kapalı kalır. Güncellemeden sonraki ilk vardiyada, aynı ağ adresinin arkasındaki
  bir serviste şifre değiştirme ve kilit açma istekleri dakikada 30 ile sınırlıdır: "çok fazla
  deneme, bir dakika sonra" yanıtı arıza değil, bir dakika beklenip yeniden denenir. Active
  Directory hesabı hiç zorlanmaz: şifresi AD'dedir, değiştirmesi hastanenin olağan yoludur.

**Kilit ekranı**
- *Basit:* Servisteki ortak bilgisayar bir süre kullanılmayınca ekran kilitlenir; hasta bilgisi
  ekrandan kalkar, oturum kapanmaz. Kilidi şifreyle açarsınız.
- *Homunculus'ta:* Süreyi hastane belirler (`SCREEN_LOCK_IDLE_MINUTES`, varsayılan 10 dakika);
  kişisel oturum her zaman kilitlenir, "hiç kilitlenmesin" seçeneği yoktur (sürekli açık kalması
  gereken duvar ekranı Grup 2'nin kiosk modudur). Kilitlenmeden bir dakika önce geri sayımlı
  uyarı çıkar. Tuş, tıklama, dokunma ve kaydırma hareket sayılır; yalnız oynayan fare sayılmaz.
  Hesap menüsünden ya da Alt+L ile (klavye düzeni ne olursa olsun) elle de kilitlenir.
  *Hangi ekranda ne olur:* oturum açıkken **kabuk kilitlenir** ve oturum kilit ekranının arkasında
  yaşamaya devam eder. Oturum henüz açılmamışsa — iki adımlı doğrulama, zorunlu şifre değişikliği,
  "sunucuya ulaşılamıyor" ekranı — kilitlenecek bir kabuk yoktur, o yüzden aynı süre dolduğunda
  **oturum biter** ve uyarı bunu söyler ("Sessiya bağlanacaq" / "Oturum kapanacak"); kişi giriş
  ekranına döner. Bu özellikle göç `0011` için önemli: bütün yerel hesaplar ilk girişte zorunlu
  şifre değişikliği ekranına düşüyor, ve o ekran eskiden hiç zaman aşımı olmadan servis klavyesinde
  kalabiliyordu. Aynı nedenle, denemesi reddedilen her seferde **cari şifre alanı boşaltılır** —
  kişinin doğru şifresi alanda bırakılmaz (yeni şifre ve tekrarı kalır, tekrarı yanlış yazınca üç
  alanı baştan yazmak gerekmesin diye). Giriş ekranının kendisinde sayaç yoktur: orada alınacak bir
  oturum yok. Kilit
  **tarayıcı başınadır**: sayfayı yenilemek ya da yeni sekme açmak kilidi geçmez; 12 saatten
  uzun kilitli kalan tarayıcı kendiliğinden çıkış yapar (`SCREEN_LOCK_SIGNOUT_HOURS`) — gece
  kilitli kalan bir servis bilgisayarı sabaha dünün oturumunu taşımaz.
  Kilitliyken ekranda yalnız kişinin birimlerindeki açık alarmların ve onaylanmamış olanların
  **sayısı** görünür (ad, yatak, değer yok). "Alarm yok" yalnız canlı bağlantı varken ve pano
  bağlantıdan sonra yeniden yüklendiyse denir; akış koptuysa sayılar "güncel olmayabilir" işaretiyle
  görünür, hiçbir şey alınamadıysa "alarm bilgisi alınamıyor — bu, alarm olmadığı anlamına gelmez"
  der. Şifre üç kez yanlış girilirse oturum kapanır (sayaç bütün sekmelerde ortaktır: üç deneme
  kilit başınadır, sekme başına değil); "Başka kullanıcıyla giriş" şifresiz çıkış yapar. Kilit
  açılınca kişi **bıraktığı ekrana** döner; tek istisna hasta sayfasıdır: oradan kilitlenmişse
  kilit açılınca ana ekrana düşer (kullanıcı kararı, 07.10.2026 — kilitli ekranı başka biri de
  uyandırabilir, bir hastanın adını taşıyan sayfa sorulmadan yeniden açılmaz). AD hesabında her
  yanlış şifre AD giriş sınırına sayılır (aşağıdaki madde): giriş adını bilen biri, girişi gibi
  kilitli ekranı da en az 15 dakika 429'da tutabilir (kullanıcı kararı 11). Sunucu "bir dakika
  sonra" derse (nginx'in `homunculus_reauth` bölgesi, `Retry-After`) kilit ekranı düğmeyi o süre
  boyunca kapatır ve kalan saniyeyi gösterir — giriş ve şifre değiştirme ekranları gibi; böylece
  arka arkaya basmak servisin ortak bütçesini boşa harcamaz. Dizin sunucusuna
  ulaşılamıyorsa AD hesabının kilidi açılamaz (kabul edildi, karar 13): çıkış yapılır, servis
  çalışmaya devam etmeliyse yerel bir hesapla girilir. Ekran kilitliyken yönetici o hesabın
  şifresini sıfırlarsa oturum kapanır ve "şifreniz sıfırlandı" denir — kişi artık açamayacağı bir
  kilit ekranının önünde bırakılmaz. AD'de kapatılmış bir hesabın kilidi de açılmaz — dizin o
  hesabı artık
  döndürmediği için yanlış şifre gibi yanıtlanır, oturum da en geç bir saat içinde kapanır.

**Yeni canlı arayüz (kabuk)**
- *Basit:* "Kabuk", her ekranın içinde durduğu çerçevedir: soldaki menü ve üstteki çubuk. Hangi
  ekranı açarsanız açın aynı kalır, bu yüzden bir kez öğrenilir.
- *Homunculus'ta:* Adres çubuğuna yalnız sunucunun adresi yazılınca yeni arayüz açılır (G1-07):
  solda kişinin yetkisinin açtığı ekranlar (telefonda kısa adlarıyla), üstte hastane adı, birim
  seçimi (kapsamı iki ya da daha çok birimle sınırlıysa; motor o an birim listesini göndermiyorsa
  çip kendini "güncel olmayabilir" diye işaretler, eski liste atılmaz), saat, dil, tema, tam
  ekran, kısayollar, yanıt bekleyen alarmların zili ve hesap menüsü (sürüm numarası dahil).
  Zilin her satırı o hastanın sayfasını açar; menüdeki Alarmlar maddesi yanıt bekleyen alarmları
  zille aynı kuralla sayar (aşağıda 3.6). Yetkisi olmayan bir sayfa "Bu səhifəyə icazəniz
  yoxdur", olmayan bir sayfa "Belə səhifə yoxdur" der. Önceki arayüz (`?eski=1`, kilit ekranını
  bilmiyordu) G1-16'da kaldırıldı: o adres de artık bu arayüzü açar (aşağıda "Eski adresler").
- *Girişten sonra nereye düşülür:* Herkes kendi ana ekranına — menüsünün açtığı ilk ekrana:
  panoyu görme yetkisi (`board.view`) olan herkes **Yataklar**'a (Azerbaycanca arayüzde
  "Çarpayılar"): hekim, hemşire, sorumlu hemşire, hızlı yanıt ekibi, denetçi, eczacı ve Sistem
  Yöneticisi. Panoyu görmeyen ama kullanıcı ya da grup yöneten biri **Yönetim**'e. Yetkileri yeni
  arayüzün hiçbir ekranını açmayan bir hesap — varsayılan gruplarda Biyomedikal Teknisyen ve
  Üretici Destek: ikisinde de yalnız cihaz ve denetim yetkisi var — içeri alınmaz; giriş ekranı
  bunu söyler ("Hesabınızın yetkileri bu arayüzdeki ekranlardan hiçbirini açmıyor (ör. yalnız
  cihaz yönetimi). Sistem yöneticinizle görüşün."). Cihaz sayfası Grup 4'te gelecek. **Ayarlar**
  herkese açık, menünün en altında. Bir yer imiyle ya da bağlantıyla açılan adres girişten sonra
  bir kez kullanılır — kişi o ekranı açabiliyorsa; bir **hastanın** adresi ise girişten sonra
  açılmaz, ana ekrana düşülür (kilit açılınca olduğu gibi: yukarıda "Kilit ekranı").
- *Bağlantı canlı mı:* Sunucu, pano akışında hiçbir şey olmasa da 15 saniyede bir "yaşıyorum"
  işareti gönderir; 45 saniye hiç ses gelmezse tarayıcı bağlantıyı kopmuş sayar, yeniden bağlanır
  ve o sırada sayıları "güncel olmayabilir" diye işaretler. Böylece yarı kopmuş bir bağlantı
  "sakin servis" gibi okunmaz.
- *Ana ekrana eklenen uygulama:* Uygulama **gerçek sistemle** kurulur — Dalga 2'den önce kısayol
  simülasyonu (`?demo=1`) açıyordu. Ana ekranda zaten duran eski bir kısayol, tarayıcı uygulama
  tanımını yeniden okuyana kadar eski adresi açar; G1-16'dan beri o adres de gerçek sistemi açar
  (aşağıda "Eski adresler"). Servis bilgisayarı ilk açılışta yalnız gerçek sistemi indirir.
- *Sayfa yüklenemezse:* Arayüzün parçaları gerektiğinde indirilir. Ağ yoksa — ya da kurulu
  uygulama deploy öncesinden kalma bir önbellek taşıyorsa — bu indirme başarısız olabilir. O
  durumda ekran boş kalmaz: kişinin kendi dilinde "Səhifə yüklənə bilmədi — bağlantınızı yoxlayıb
  yenidən yükləyin" der ve bir "Yenidən yüklə" düğmesi verir; hata ayrıntısı tarayıcı günlüğüne
  yazılır (destek çağrısı oradan başlar).

**Eski adresler (G1-16)**
- *Basit:* Panonun eski hâllerine götüren adresler artık hep gerçek sisteme götürür; yer imleri ve
  eski kısayollar boş sayfa ya da hata göstermez.
- *Homunculus'ta:* Simülasyon (`?demo=1`, `#/demo`), önceki canlı arayüz (`?eski=1`), replay
  (`?mode=replay`, `?scenario=…`) ve eski pano (`?board=1`, `&token=…`) G1-16'da koddan çıktı. Bu
  adreslerden biriyle açılan sayfa gerçek sistemi açar (oturum yoksa giriş ekranını) ve parametre
  daha hiçbir şey çizilmeden adres çubuğundan silinir: gerçek hastaların üstünde "demo" yazan bir
  adres kalmaz, eski panonun adreste taşıdığı cihaz anahtarı da adres çubuğundan silinir.
  `?live=1` eskisi gibi kabul edilir; `?tasarim=1` tasarım galerisini açar. Silinen kod `e4cdf15`
  commit'inde okunur. Vercel'deki genel demonun yayından kaldırılması kod işi değil, kullanıcının
  işidir.

**Alarm sesi ve kritik alarm bildirimi**
- *Basit:* Yanıt bekleyen bir alarm varken servis bilgisayarı ses çıkarır; sayfa arka plandayken
  kritik bir alarm için Windows bir bildirim gösterir. İkisi de bu tarayıcıda açılır.
- *Homunculus'ta:* Ayarlar › "Ses ve bildirim". **Ses** (kapalı başlar, açılınca bu tarayıcıda
  saklanır): yanıt bekleyen alarmların en kötüsüne göre, eski arayüzün ses düzeniyle çalar —
  kritikte 2,5 saniyede bir 10 vuruş (5+5), yüksekte 12, ortada 20 saniyede bir 3 vuruş; düşük ve
  bilgi sessizdir; önem derecesi bilinmeyen bir alarm kritik gibi çalar. Alarm onaylanınca susar;
  durumu geçince de susar — kimsenin onaylamadığı kritik bir alarm durumu geçince «geçti ·
  onaylanmadı» olarak yanıt beklemeye devam eder ama çalmaz, yeni bildirim de getirmez (G2-A1).
  Ekran **kilitliyken de çalar**; oturum kapanınca durur, o an çalmakta olan vuruşlar da kesilir.
  Pano ilk yüklemesini aldıysa, sunucuyla akış daha açılmadan da çalar; akış koparsa panonun son
  bildiğini çalmaya devam eder; pano hiç okunamıyorsa çalmaz. Tarayıcı sesi askıya alıp geri
  verirse (örneğin bir ses aygıtı değişince) ses kendiliğinden sürer. Tarayıcılar sesi ancak bir
  tıklama ya da tuş vuruşundan sonra başlatır: sayfa yeniden açıldıysa ses "bekliyor"dur ve ekranın
  köşesindeki düğme bunu söyler (ekran okuyucuya da) — giriş ya da kilit açma için yazmak da sesi
  başlatır. "Sesi dene" bir kritik düzen çalar. **Bildirim** (tarayıcı izin isterse "İzin ver"):
  sayfa arka plandayken her yeni kritik alarm için bir bildirim — önem derecesi bilinmeyen bir
  alarm da kritik sayılır —, yatağın etiketiyle (etiket yoksa hasta kimliğiyle — eski arayüzdeki
  gibi, kullanıcı kararı 13.10); ekran kilitliyken bildirim hiçbir yatak ya da hasta adlandırmaz.
  Bildirim kilit açılınca, cevaplanan bir alarm yeniden bekleyince ve her yeni oturumda yeniden
  gelir; dışarıdan kapatılırsa (kullanıcı, işletim sistemi, başka bir sekme) ve alarm hâlâ
  bekliyorsa, panonun bir sonraki değişikliğinde yeniden gelir. Aynı tarayıcının iki sekmesi aynı
  alarm için bildirimi üst üste yığmasın diye her bildirim alarmın bölümüne göre etiketlenir
  (G2-A1: kapanıp yeniden çıkan bir alarm yeni bir bildirimdir, eskisinin yerine sessizce geçmez);
  etiket bölümün kimliğinin bir özetidir (hash), hasta kimliğini taşımaz. Sayfa kapanınca ya da yenilenince açık bildirimler kapanır; sayfa
  kapalıysa bildirim gelmez; güvenli olmayan (HTTPS olmayan) bir adreste tarayıcı bildirim
  göstermez, ekran da bunu söyler. Eski arayüzden taşındı (G1-16). Ses düzeni eski arayüzünkidir;
  bir klinik standarda (IEC 60601-1-8) göre gözden geçirilmedi — Grup 2'de bir klinisyen ya da
  biyomedikal mühendis bakacak.

**Active Directory ile giriş**
- *Basit:* Hastanedeki bilgisayar hesabıyla (kullanıcı adı ve Windows parolası) giriş.
  Homunculus bu parolayı saklamaz; her girişte hastanenin dizin sunucusuna bir kez sorar.
- *Homunculus'ta:* `LDAP_URL` ayarlanınca açılır (kurulum ve hastane BT'sinden istenecekler:
  `docs/EDGE-BRIDGE-LOCAL.md`, "Active Directory sign-in"). Kimse kendiliğinden hesap açamaz:
  yönetici kişiyi AD'de arar ve içe aktarır (istek başına en çok 50 kişi). AD'de kapatılmış ya
  da süresi dolmuş hesap, adı yerel kullanıcı adı kuralına uymayan hesap (ör. `ş`, `ç`, `ğ`
  içeren) ve adı başka bir hesapta kullanılan hesap aktarılmaz; yanıt her birini nedeniyle
  söyler. Kişi kullanıcı adıyla, `ALAN\kullanıcı` biçimiyle, UPN'iyle (`ad@alan`) ya da
  e-postasıyla girebilir. Dizin sunucusuna ulaşılamazsa AD hesapları "Dizin sunucusuna
  ulaşılamıyor" (503) alır, açık oturumlar sürer, yerel hesaplar etkilenmez. AD'de kapatılan,
  süresi dolan, silinen ya da parolası değişen hesabın oturumu en geç bir saat içinde, token
  yenilenirken kapanır; Homunculus'taki "etkin" bayrağı kendiliğinden değişmez. Her kurumda en
  az bir **yerel** yönetici kalır; sistem sonuncusunun kaldırılmasına izin vermez, çünkü AD
  çöktüğünde yönetime girebilecek tek hesap odur. Reddedilen her giriş en az 0,5 saniye sürer:
  yanıt süresi bir adın AD hesabı olup olmadığını ele vermesin diye. (Dizin kapalıyken AD
  hesabı hemen 503 alır, öbürleri 401: o anda AD hesapları yine ayırt edilir — kullanıcı
  kararı 11.) Kurulumdan sonra dizinin bağlanıp bağlanmadığı yönetici olarak
  `GET /admin/ldap/status` ile görülür (`last_test_ok: true`); yeni arayüzde aynı bilgi Yönetim ›
  Giriş kaynağı › Durum kutusundadır ve "Bağlantıyı dene" düğmesi bağlantıyı orada sınar
  (aşağıda "Yönetim ekranı"). Parola hastanenin dizinine
  yazıldığı gibi, değiştirilmeden gider: bölünmez boşluk ya da birleşik yazılmamış bir `ş`
  içeren doğru parola da kabul edilir. Sunucu üretimde `LDAP_ALLOW_INSECURE=1` ile açılırsa
  AD girişi kapalı kalır (şifresiz ya da doğrulanmamış bağlantıda AD parolaları ağda okunabilir).

**AD grup eşlemesi**
- *Basit:* "AD'de YB-Hemşire grubunda olan, Homunculus'ta Hemşire grubundadır" kuralı.
- *Homunculus'ta:* Eşleme her girişte ve her token yenilemesinde yeniden uygulanır: AD'de bir
  gruba eklenen ya da gruptan çıkarılan kişinin yetkisi en geç bir saat içinde değişir; dizine
  ulaşılamıyorsa hiçbir şey değişmez. Yöneticinin elle verdiği gruplara dokunulmaz. Yeni bir
  eşleme herkese bir sonraki giriş ya da yenilemede uygulanır; silinen eşlemenin verdiği yetki
  hemen geri alınır. Eşlemeyi yalnız **bütün kataloğu taşıyan** yönetici ekleyip silebilir,
  çünkü bir eşleme o AD grubundaki herkesi bir kerede yeniden gruplar; kullanıcı yöneticisi
  tabloyu yalnız okur. AD grubu DN'iyle (ayırt edici adıyla) tanınır; DN tek bir yazımla
  saklanır ve karşılaştırılır (boşluklar, kaçışlar ve İngilizce harflerin büyük/küçüklüğü fark
  etmez, `Ş`/`ş` gibi harfler ise yazıldığı gibi karşılaştırılır — grubu elle yazmak yerine
  seçiciden seçin). AD'de adı değişen ya da taşınan grubun eşlemesi sessizce kopar (açık iş,
  Grup 4).

**AD giriş sınırı ve kilit açma**
- *Basit:* Homunculus'a yanlış girilen parola hastanenin hesap kilitleme sayacına da işler.
  Homunculus kimsenin Windows hesabını kilitletmesin diye hatalı denemeleri sınırlar.
- *Homunculus'ta:* Hatalı denemeler AD'nin saydığı gibi sayılır: bir **hatalı deneme dizisi**,
  son hatalı denemeden sonra 15 dakika hatasız geçince biter (eski hatalar tek tek düşmez).
  Dizide 3 yanlış parola olunca sonraki giriş, dizine hiç sorulmadan, 429 ile reddedilir: "Çok
  fazla hatalı deneme; 15 dakika sonra tekrar deneyin" — son hatalı denemeden 15 dakika sonrasına
  dek; reddedilen deneme dizine gitmediği için diziyi uzatmaz. Doğru parolayla giriş diziyi
  bitirir — ama yalnız o giriş başlamadan önceki hatalar için: doğru parola denetlenirken
  başarısız olan yanlış parolalar dizine ondan sonra ulaşmış olabilir, AD onları sayar; bu
  yüzden yeni diziyi başlatırlar. Sayaç bellekte tutulur, sunucu yeniden başlayınca da
  sıfırlanır — AD'ninki sıfırlanmaz: son hatalı denemeden sonraki 15 dakika içinde yapılan bir
  yeniden başlatma ya da güncelleme, sınırı o sayım için ikiye katlayabilir (6 yerine 12);
  güncellemeden önce son 15 dakikada hatalı AD girişi olmadığına bakılır (runbook). Yönetici,
  gerekçe yazarak, kullanıcıya 3 deneme hakkı daha verebilir
  (`POST /admin/users/{id}/unlock-sign-in`): **dizi başına bir kez** — ikincisi 409: "Bu
  hesabın bu hatalı giriş dizisi için tek kilit açma hakkı kullanıldı; 15 dakika hatalı parola
  girilmezse giriş kendiliğinden açılır". Denetim kaydı kilit açmanın öncesini ve sonrasını
  (`failed`: dizideki hatalı deneme, `allowed`: 3 ya da 6) ve bir şey verip vermediğini
  (`granted`) yazar; yanıt da artık bunları taşır, yani yönetim ekranı "3 deneme daha" ile
  "açılacak bir sınır yoktu"yu ayırt eder ve kaç deneme tanındığını sunucunun sayısıyla söyler —
  onaydan önce sayı vaat etmez. Hatalı denemesi olmayan bir hesapta (ya da yerel
  hesapta) kilit açma hiçbir şey vermez ve dizinin hakkını harcamaz; başka kurumda da etkin bir
  hesap ya da platform operatörü için olmaz. Gerekçe tek satır, en çok 200 karakter, en az bir
  harf ya da rakam içerir; görünmez biçim karakterleri (yön değiştiriciler, sıfır genişlikli
  karakterler) kabul edilmez. Böylece Homunculus bir hesap için AD'nin sayacına, sayaç
  sıfırlanmadan, en çok 3 + 3 = 6 hatalı deneme ekler — beş dakikada bir girilen yanlış parola
  dahil; hastanenin kilitleme eşiği en az 7, sıfırlama süresi en çok 15 dakika olmalıdır. Bu,
  AD'deki kilidi açmaz — o, BT biriminin işidir. Ayrıca nginx giriş adresini istemci adresi
  başına dakikada 10 denemeyle (ve 10 ani denemeyle) sınırlar: "Çok fazla giriş denemesi; bir
  dakika sonra tekrar deneyin". Servis bilgisayarları tek bir adresin (NAT, terminal sunucusu)
  arkasındaysa bu sınırı bütün servis paylaşır. Denetim kaydında bir dizi, aynı hesap için
  `login.fail` satırları ve ardından `throttled` olarak görünür; dizinin saydığı her hatalı
  deneme bir satır bırakır — parolası dizine gittikten sonra yarıda kesilen bir giriş de
  (örneğin sunucu istek sürerken kapanıyordu) `cancelled` nedeniyle. Bedeli: bir klinisyenin giriş
  adını bilen herkes, 15 dakikada 3 yanlış parolayla onun Homunculus girişini 429'da tutabilir
  (Windows oturumunu kilitlemez); yönetici bunu dizi başına bir kez açabilir (kullanıcı kararı
  11).

**Yönetim ekranı (Kullanıcılar · Roller ve yetkiler · Giriş kaynağı)**
- *Basit:* Hastanenin kendi hesaplarını, gruplarını ve kurumsal (AD) girişini yönettiği sayfa.
  Sol menüde "Yönetim" (Azerbaycanca arayüzde "İdarə"); içinde üç sekme var: Kullanıcılar, Roller
  ve yetkiler, Giriş kaynağı ("İstifadəçilər", "Rollar və səlahiyyətlər", "Giriş mənbəyi").
  Sayfanın başlığı her değişikliğin denetim kaydına yazıldığını söyler.
- *Kim açabilir:* Sayfa `users.manage` ya da `groups.manage` izni olana açılır, her sekme de
  kendi iznine bakar: Kullanıcılar ve Giriş kaynağı `users.manage`, Roller ve yetkiler
  `groups.manage` ister. Varsayılan gruplarda ikisi de yalnız Sistem Yöneticisi'ndedir. Ekrandaki
  gri düğmeler ve kilitli sütunlar yalnız ipucudur: her yazmayı sunucu kendi kurallarıyla yeniden
  denetler. Reddederse nedeni bildirimde (toast) yazar ve bildirim neyin reddedildiğini adıyla
  söyler (hesap, grup, AD grubu); bildirim sekme ya da ekran değişince kaybolmaz.
- *Kullanıcılar:* Hastanedeki bütün hesaplar tek listede: ad, kullanıcı adı, rol, birimler, durum,
  2FA, son giriş, işlemler. Arama ve rol süzgeci tarayıcıda çalışır; liste 50'şer satır gösterilir.
  Bir hesapta bir **rol**, istenen sayıda **ek görev** (Sorumlu Hemşire, Hızlı Yanıt Ekibi) ve
  hastanenin kendi açtığı **diğer gruplar** seçilir; AD'den gelen gruplar burada değiştirilemez.
  İşlemler: düzenle, şifre sıfırla, 2FA sıfırla, pasifleştir / etkinleştir, girişi aç (yukarıda
  "AD giriş sınırı ve kilit açma") ve birimler. Kaydedilen ya da kaydedilmiş olabilecek her
  yazmadan sonra — birimler kaydı da dahil — liste ve "Hiç atama yapılmamış kullanıcı" sayısı
  sunucudan yeniden okunur.
  - **Birimler (birim kapsamı):** kişinin panoda hangi birimlerin ve yatakların hastalarını
    gördüğü. Bütün kullanıcıların kapsamını birden okuyan bir uç yok, bu yüzden "Birimler" sütunu
    bir kişinin kapsamı okunana dek "Okunmadı" der; birimler penceresi açılınca okunur. Penceredeki
    seçenekler panodaki kartlardan, kişinin mevcut atamalarından ve elle yazılan bir anahtardan
    gelir (hastası olmayan boş bir birim panoda görünmez, anahtarı elle yazılır). Kapsamı yalnız
    kendi kapsamı **rolü gereği** sınırsız olan yönetici (Sistem Yöneticisi ya da platform
    operatörü) kaydedebilir; `users.manage` tek başına yetmez. Ataması olmayan bir hesap bugün
    bütün hastaları görür; sunucu ataması olmayanları kısıtlayacak biçimde ayarlanırsa
    (`SCOPE_ENFORCE_UNASSIGNED`) yalnız bakım ekibinde adı geçtiği ya da acil erişimle açtığı
    hastaları görür. Ekran hangisinin geçerli olduğunu sunucudan okuyup yazar. Sekmedeki "Hiç
    atama yapılmamış kullanıcı" sayısı yöneticileri ve platform operatörlerini saymaz — onların
    atamaya ihtiyacı yok.
- *Roller ve yetkiler:* Grup × yetki tablosu: her sütun bir grup, her satır bir yetki; yetkinin
  açıklaması okuyanın dilinde, altında izin anahtarı (destek çağrısında anılan odur). Kilitli
  sütunlar: Sistem Yöneticisi (hakları kural gereği bütün katalog), yetkileri sizinkini aşan bir
  grup ve kataloğun tanımadığı bir yetki taşıyan grup (oradan kaydedilse o yetki sessizce
  silinirdi). Sahip olmadığınız bir yetkinin kutusu işaretlenemez. Üyesi olan grup silinemez;
  nedeni sütun başlığında yazar. Yeni grup buradan açılır.
- *Giriş kaynağı:* **Durum** — dizin yapılandırılmış mı, sunucunun adı, son bağlantı denemesi —
  ve "Bağlantıyı dene". Deneme başarısızsa beş nedenden birini neyin kontrol edileceğiyle söyler
  (sunucuya ulaşılamadı; süre içinde yanıt yok; şifreli bağlantı kurulamadı; servis hesabı
  reddedildi; beklenmeyen yanıt). **Hesap ara ve içe aktar** — dizin listelenmez, aranır (en az 2
  karakter, en çok 50 sonuç); seçilen hesaplar ikişer ikişer, sırayla aktarılır. Yönetici başka
  sekmeye geçse de aktarma biter ve sonucu bildirime düşer; çıkış yapılırsa durur. Atlanan her
  hesap nedeniyle listelenir; "bu dizin hesabı için zaten bir hesap var" başka bir hastanedeki
  hesap da olabilir. Aktarmayı tekrarlamak zararsızdır. **AD grup eşlemesi** — AD grubu elle
  yazılmaz, aranıp listeden seçilir; eşlemeyi yalnız bütün kataloğu taşıyan yönetici değiştirir,
  diğerleri okur. Yeni bir eşleme kimseyi hemen değiştirmez (kişiler grubu bir sonraki
  girişlerinde alır); bir eşlemeyi silmek ise o grubun AD'den gelen üyeliklerini **hemen** kaldırır
  (başka bir eşlemeyle hak eden kişi bir sonraki girişinde geri alır) — Kullanıcılar ve Roller
  sekmeleri bunu silmenin hemen ardından gösterir. Dizin işlemleri 30 saniyeye kadar sürebilir.
- *Yöneticilerin soracağı üç şey:*
  1. **"Geçici şifre nerede görünüyor?" — Hiçbir yerde.** Ekran şifre üretmez: geçici şifreyi
     yönetici kendisi yazar (en az 8 karakter; sunucunun kuralı, sunucunun saydığı gibi sayılır).
     Alan gizli yazılır ve pencere kapanınca boşaltılır; şifre bildirimde, sayfada ya da bir
     başlıkta bir daha görünmez. Kişiye yüz yüze ya da telefonla iletilir, e-postayla gönderilmez;
     kişi sonraki girişinde kendi şifresini belirler. Unutulursa ekrandan okunamaz: "Şifre
     sıfırla" ile yeni bir geçici şifre belirlenir (kişinin açık oturumları kapanır).
  2. **"Kutuyu işaretledim; yetki verildi mi?" — Henüz değil.** Kutu yalnız değişikliği toplar;
     sütun kaç değişikliğin beklediğini söyler. Grubun kendi "Kaydet"ine basılınca o grubun bütün
     yetki listesi tek istekte gider ve denetim kaydına yazılır. Gruplar tek tek kaydedilir,
     "hepsini kaydet" yoktur: sunucu bir grubu bütün olarak yazar; üç grubun ikincisi reddedilse
     tablo kimsenin seçmediği bir hâlde kalırdı. Bu arada başka bir yönetici aynı grubu
     kaydettiyse kaydınız reddedilir (sunucu sizin okuduğunuz listeyle şimdikini karşılaştırır),
     sütun yeniden okunur ve işaretleriniz durur: yeni duruma bakıp tekrar kaydedersiniz.
     Kaydedilmemiş işaretler başka sekmeye geçince kaybolur. Gruptaki kişiler yeni yetkiyi oturum
     kapanmadan, token'ları yenilenince alır (yukarıda "RBAC").
  3. **"Dizin sunucusunun adresini nereden değiştiririm?" — Bu ekrandan değil.** Adres
     (`LDAP_URL`) ve servis hesabı sunucu yapılandırmasıdır; BT birimiyle kurulumda ayarlanır.
     Ekran yalnız sunucunun adını gösterir; servis hesabı ve şifresi hiçbir yanıtta yer almaz.
     Dizin yapılandırılmamışsa sekme yalnız bunu söyleyen bir not gösterir.
- *Bilinmesi iyi olanlar:*
  - Bir yazmaya yanıt gelmezse (zaman aşımı, kopan bağlantı, yanıt veremeyen sunucu) ekran
    "reddedildi" demez: "Değişiklik yine de uygulanmış olabilir: yeniden denemeden önce kontrol
    edin." der ve ilgili listeyi sunucudan yeniden okur. Bir okuma başarısız olursa bunu demez —
    okunamayan bir listede değişen bir şey yoktur.
  - Bir hesabı düzenlemek yalnız değiştirilen alanları gönderir: bir ad düzeltmesi, başka bir
    masada pasifleştirilmiş hesabı yeniden etkinleştirmez. Grupları bu arada başka bir masada
    değiştirilmiş bir hesabın gruplarını kaydetmek reddedilir; form kapanır ve "Bu hesap, bu
    pencere okuduktan sonra değişti — başka bir masada ya da yanıt alamayan önceki bir kaydınızla;
    şimdiki hâlini görmek için hesabı yeniden açın." der. (Yanıt alamayan bir kayıt sonradan
    yerine geçmişse, değişikliği yapan kişinin kendisi olabilir; cümle bu yüzden ikisini de
    söyler.) Birimler
    de böyledir: pencere açıldıktan sonra başka bir masada değiştirilmiş bir kapsamı kaydetmek
    reddedilir (sunucu pencerenin okuduğu atamaları şimdikilerle karşılaştırır; hiçbir şey
    yazılmaz), pencere kapanır, aynı cümleyi söyler; satır ve sayı yeniden okunur. Aynı anda
    yapılan iki kapsam kaydı da sırayla işlenir, ikisinin birleşimiyle bitmez.
  - Bildirimler ekran kilitlenirse kilit boyunca bekler ve kilit açılınca gösterilir; çıkış
    yapılırsa bir sonraki oturuma taşınmaz. Kilit sırasında sonuçlanan **başarılı** bir kayıt bugün
    onaylanmaz (bir ret yine bildirilir) — açık iş, Grup 3.
  - Ekran bütün hesap listesini tek istekte yükler; 200 ya da daha çok hesapta bunu kendisi
    söyler. İkinci bir hastaneden önce sunucu tarafında sayfalama gerekecek.
  - AD'den gelen bir Sistem Yöneticisi üyeliği son yönetici korumasında sayılmaz (yukarıda
    "Yönetici"): yalnız AD yöneticileri kalmış bir hastanede son **yerel** yöneticinin
    kaldırılması reddedilir. Ekran bunun nedenini henüz söylemiyor (Grup 3).

**Yetkilerin yeniden okunması**
- *Basit:* Panelin menüde gösterdiği haklar bir ipucudur; asıl kararı her istekte sunucu verir.
- *Homunculus'ta:* Panel, fark ettirmeden yenilenen her token'dan hakları yeniden okur, böylece bir
  yetki değişikliği oturum kapanmadan menüye yansır. Personel sekmesi açılırken haklar `/auth/me`
  üzerinden veritabanından okunur: yeni bir sürüm izin eklediyse, eski token'ı olan bir yönetici de
  gerçek haklarını görür. Bir hak kaybedilirse sunucu 403 der; hata her zaman kapalı yönde olur.
  (Bu, önceki arayüzün personel sekmesi içindir. Yeni yönetim ekranı açılırken `/auth/me`'yi
  yeniden okumaz: oturum token'daki hakları her istekten sonra, `/auth/me`'yi de girişte ve sayfa
  açılırken zaten yeniden okuyor.
  Bedeli: bir izin anahtarı ekleyen sürümden önce alınmış token'ın ömrü boyunca — en çok 60
  dakika — bütün yetkili bir yönetici yeni anahtarın kutularını "bu yetkiye sahip değilsiniz" diye
  gri görebilir; sunucu kabul ederdi. Açık iş, Grup 3.)

**Oturumun korunması ve "Tekrar dene"**
- *Homunculus'ta:* Sayfa yenilenince panel kayıtlı oturumu sunucuya sorar. Sunucu oturumu
  **reddederse** (401/403) oturum temizlenir ve giriş ekranı gelir. Sunucuya **ulaşılamazsa** (ağ
  kesintisi, 5xx) oturum kapatılmaz: giriş ekranı "Sunucuya şu an ulaşılamıyor; oturumunuz açık"
  der ve "Tekrar dene" düğmesini gösterir. Aynı anda yalnızca bir deneme yapılır. Böylece bir kesinti
  klinisyeni vardiya ortasında oturumdan atmaz.

**Canlı mod: simüle edilen hiçbir şey gösterilmez**
- *Basit:* Gerçek sistemde, arkasında gerçek bir kayıt olmayan hiçbir düğme "çalışıyormuş gibi"
  durmaz.
- *Homunculus'ta:* Panoda simülasyon yok: ekranlar yalnız gerçek API'nin yaptıklarını çizer;
  arkasında bir uç olmayan ekran ya da düğme yoktur (yukarıda "Yeni canlı arayüz", aşağıda 3.6).
  G1-16'dan beri tek arayüz budur — simülasyon (`?demo=1`) ve onunla aynı ekranları kullanan önceki
  canlı arayüz (`?eski=1`) koddan çıktı (yukarıda "Eski adresler"). Önceki arayüzün **sesli
  alarmı** ve arka plandaki **kritik alarm bildirimi** silinmeden önce yeni arayüze taşındı
  (yukarıda "Alarm sesi ve kritik alarm bildirimi").

---

### 3.6 Yeni arayüzün klinik ekranları (Yataklar · Alarmlar · Hasta)

Grup 1'in üç klinik ekranı Dalga 3'te geldi. Üçü de tek bir kuralla yazıldı: **ekran motorun ve
hastanenin gönderdiğini gösterir, kendisi hiçbir klinik değer hesaplamaz** — skor, bant, normal
aralık, değere göre renk ya da kendi riskini üretmez. Homunculus tanı koymaz; bu ekranlar da
koymaz: gösterdikleri motorun bulguları ve gerekçeleridir, kararı klinisyen verir. Aşağısı
ekranların *ne gösterdiğini ve neyi asla iddia etmediğini* anlatır, tıbbi bir yorum değildir;
klinik kavramların kendisi yukarıda, kaynaklarıyla (3.1–3.3).

**Gösterim kuralları (üç ekranda da aynı)**
- *Basit:* Ekran bilmediği bir şeyi "her şey yolunda" gibi göstermez.
- *Homunculus'ta:*
  - **Hiçbir şey yeşil değil.** Risk hapı motorun düzeyini sözcük, simge ve renkle birlikte söyler;
    renk hiçbir zaman tek ipucu değildir (kartın sol şeridi hapın rengini tekrarlar, yanında hep
    sözcük vardır). "Orta" amber; "Bulgu yok" ve "Bilgi" nötr gri; hiçbir düzey yeşil bir
    "stabil"e dönmez.
  - **"Ölçülmedi" ≠ "Bulgu yok".** "Bulgu yok", ölçümü olan bir hastada motorun alarm üretmediği
    demektir — değerlerin normal olduğu iddiası değildir. Monitöründen hiç ölçüm gelmemiş bir
    hastada aynı yanıt "Ölçülmedi" diye okunur.
  - **Bilinmeyen dikkat ister.** Motor risk göndermediyse ("Risk bildirilmedi") ya da bu sürümün
    tanımadığı bir düzey gönderdiyse ("Tanımsız risk: …"), hap dikkat görünümü alır — sakin gri
    asla. Sıralamada da en üste çıkar: en kötüsü olabilir.
  - **"Bekleyen yok"u yalnız canlı pano söyler.** Bağlantı bozulursa ekranın üstünde bir şerit
    çıkar. Canlı akış koptuysa veriler gösterilir ama "güncel olmayabilir" diye işaretlenir.
    Sunucuya hiç ulaşılamıyorsa: "Sunucuya bağlantı yok — hasta listesi gösterilmiyor. Bu ekran
    hasta olmadığı anlamına GELMEZ." Boş bir pano sakin bir servis gibi görünmez; alarm sayıları
    bilinemeyen bir panodan "0" diye basılmaz.
  - **Yaş, sunucunun saatiyle.** Her değerin ve alarmın yaşı sunucunun zamanına göre sayılır;
    servis bilgisayarının saati yanlışsa sunucunun yanıtlarındaki saatle düzeltilir — yanlış bir
    saat eski bir ölçümü taze gösterebilirdi. Ekran yaşı söyler, "çok eski"ye karar vermez: o eşik
    motorundur; motorun bayat saydığı girdiler bulgunun altında motorun sözleriyle yazılır.
  - **NEWS2 motorun.** Tek NEWS2 vardır, motorunki. Motor göndermediyse "NEWS2: —"; eksik vitalle
    hesaplanmışsa yanında "kısmi" hapı (ekran okuyucu ölçülmeyen parametreleri de okur). "Bir
    parametre 3 puan aldı" hapı motorun bildirdiği bir olgudur ve düzeyi değiştirmez.
  - **Motorun metinleri İngilizce.** Bulgu özetleri, gerekçe, öneriler ve kesinlik motorun yazdığı
    gibi, İngilizce gösterilir ve ekran bunu okuyanın dilinde söyler ("Motorun metinleri
    İngilizcedir; çevrilmemiştir."). Klinik bir cümleyi ekran kendisi çevirmez — çeviri de bir
    iddiadır. Pilot öncesi Azerbaycanca konuşan bir klinisyen bu metinleri okuyup yazıldığı gibi
    anlaşıldığını onaylayacak (G1-15 deploy kapısı). Motorun kapsam cümlesi ise Türkçe gelir;
    altında okuyanın dilinde "Bu cümleyi sunucu yazdı" satırı vardır.
  - **Bir ret, neyin reddedildiğini söyler.** "Gördüm" ya da şüpheli enfeksiyon işaretlemesi
    reddedilirse ret bildirimde (toast) neyin reddedildiğiyle görünür ve ekrandan ayrılınca
    kaybolmaz. Ret bildiriminde hastanın adı değil yatağı (yatağı yoksa kimliği) yazılır.

**Yataklar** (Azerbaycanca arayüzde "Çarpayılar")
- *Basit:* Servisin yatak yatak görünümü; panoyu gören herkesin girişten sonraki ilk ekranı.
- *Homunculus'ta:* Yukarıdan aşağı: bağlantı şeridi; motorun kapsam cümlesi (pano neden bu kadar,
  kaç kart kapsam dışında kaldı); yanıt bekleyen alarm sayısı ve en eskisinin ne zamandır açık
  olduğu (Alarmlar ekranına götürür); besleme çipi — kaç yatak sustu, kaçından hiç ölçüm gelmedi,
  en eski ölçümün saati (yalnız canlı panoda; bir bağlantı kopukluğunu servisin monitörlerine
  yüklemesin diye); sonra yataklar. Her kartta: sunucunun eşlediği yatak; HBYS'nin verdiği ad ya
  da "kimlik bekleniyor" (cihazın hasta numarası ad yerine yazılmaz); risk hapı; açık alarmlar
  motorun özetiyle; yalnız değeri olan kanallar, birimleriyle (hiç ölçüm yoksa bir cümle: "Bu
  yataktan hiç ölçüm gelmedi."); motorun NEWS2'si; son ölçüm saati ve gecikmiş kanal sayısı;
  kimliğin nereden geldiği (HBYS, elle giriş ya da kimlik kaydı yok); yatak tablosunun
  karşılamadığı bir HBYS konumu ("Yatak eşleşmedi · …" — tabloya eklenmesi gereken satır).
- *Sıra ve süzgeç:* Kart ya da liste görünümü, yatak ya da risk sırası bu tarayıcıda hatırlanır.
  **Yatak sırası** varsayılandır ve yerinden oynamaz: bir alarm yatağı öne çıkarır, listeyi yeniden
  dizmez (yatağın ekrandaki yeri ezberlenir). **Risk sırası** istenirse motorun düzey sırasını
  izler. Arama yatakta, kimlikte ve HBYS adında arar; büyük/küçük harf ve aksan fark etmez (ə/e,
  ı/i dahil). **Birim süzgeci** — kapsamı iki ya da daha çok birim olan için — ekranın kendi
  seçicisidir (telefonda üst çubuğun birim çipi gizli) ve çiple aynı seçimdir. **Hatırlanmaz:**
  kilit ya da çıkışla gider, ortak bir istasyonda bir sonraki kişi başkasının daralttığı servise
  açmasın diye. Süzgeç ya da arama kart gizliyorsa ekran kaç kart gizlediğini her zaman yazar.
- *Göstermedikleri:* prototipteki uydurma dikkat kutuları ("3 sonuç görülmedi · laktat 4.1 dahil",
  "1 cihaz sessiz · RE07"), ağrı, düşme ve bası yarası çipleri, rastgele çizilmiş küçük eğriler ve
  tarayıcının kendi risk hesabı.

**Alarmlar** (Azerbaycanca arayüzde "Siqnallar")
- *Basit:* Açık alarmların listesi: hangisi yanıt bekliyor, hangisine biri bakıyor.
- *Homunculus'ta:* İki bölüm. **Yanıt bekliyor** ("Cavab gözləyir"): en ağır ve en eski üstte, bu
  sürümün tanımadığı bir şiddet hepsinin üstünde. **Değerlendiriliyor** ("Qiymətləndirilir"): biri
  "Gördüm" demiş olanlar. Her satırda şiddet hapı, yatak (hastanın sayfasına götürür), motorun
  özeti, açık kalma süresi (bir saatin altında `d:ss`, üstünde `s:dd:ss`; motor ilk görülme
  zamanını göndermediyse süre yazılmaz, uydurulmaz), "Eskale edildi" (motorun bayrağı), "Gördü:
  <kişi>" ve saati. "Yalnız kritik" süzgeci kaç alarmı gizlediğini yazar; başlıktaki "Açık" sayısı
  süzgeçten bağımsız, servisin tamamını sayar ve yalnız canlı panoda görünür.
- *"Gördüm":* Yalnız `alerts.ack` yetkisi olana çizilir — varsayılan gruplarda hemşire, hekim,
  sorumlu hemşire, hızlı yanıt ekibi, sorumlu hekim, ünite hekimi ve Sistem Yöneticisi; denetçi ve
  eczacıda yoktur, onlara ekran hangi yetkinin gerektiğini söyler. Sunucu kabul etmeden ekranda
  hiçbir şey değişmez: "Gördü: …" bir kişi hakkında bir iddiadır, olmamış bir onay için yazılmaz.
  Pano güncel değilken düğme kalır (onay sunucuya gider, liste eski olabilir — ekran bunu yazar).
- *Eskalasyon:* Motorun işidir; ekran yalnız motorun bildirdiği "Eskale edildi" durumunu gösterir.
  Prototipteki 3/5/10 dakikalık basamaklar canlı sistemde yoktur. Erteleme ve elle eskalasyon
  Grup 2'de.
- *Hastanın kendi normaline göre düşürülen bulgu:* Motor bir bulguyu hastanın kayıtlı kronik
  normaline göre düşürdüyse yanında nötr bir "Hastanın kendi normaline göre beklenen" hapı durur;
  motorun açıklaması hasta ekranındadır. Bulgu kartta ve listede kalır, ama "yanıt bekleyen"
  sayısına, zile ve menü sayacına girmez — motor onu "görünür kalsın ama alarm vermesin" diye
  işaretledi. Düşürülmüş bir kritik ya da yüksek yine sayılır.

**Hasta ekranı**
- *Basit:* Tek bir hastanın özeti: motor ne ölçtü, ne buldu, neye dayanarak.
- *Homunculus'ta:* Karttan, listeden, alarm satırından ya da zilden açılır; ekranda "Yataklara
  dön" bağlantısı vardır ve menüde Yataklar maddesi güncel görünür. Gösterdikleri:
  - yatak ve HBYS adı (ya da "kimlik bekleniyor"), risk hapı, motorun NEWS2'si;
  - **ölçülen her değer, saatiyle ve yaşıyla** ("3 dk önce") — yaşı yazılmayan bir sayı, bir saat
    önce gelmeyi bırakmış bir sayıdan ayırt edilemez;
  - motorun her bulgusu için bir kart: şiddet, özet, "Değerlendirme önerilir · karar hekimindir.",
    motorun **gerekçesi**, **dayanağı** (kasadaki kaynakların adları), **düşünülebilecekler**,
    **kesinlik**, motorun bayat saydığı girdiler ve — düşürüldüyse — hastanın kendi normaline göre
    açıklaması. Hiçbiri ekran tarafından yeniden yazılmaz;
  - **Sepsis-3 bağlamı:** SOFA, bazal SOFA ve yükselme, her biri kendi etiketinin altında ve motorun
    gönderdiği gibi (ekran çıkarma yapmaz: motor yükselmeyi göndermediyse "—"); bazal SOFA
    girilmemişse motorun 0 varsaydığını söyler;
  - **ilaç ve antibiyotik:** motorun yayımladığı vazopressör/inotrop kayıtları, antibiyotiğin
    verildiği saat ya da penceresinin dolduğu saat; antibiyotik kaydı yoksa "kimse kaydetmedi —
    verilmediği anlamına gelmez". Antibiyotik penceresi (1 saat) sepsisin ya da septik şokun fark
    edildiği anda başlar; antibiyotik uyarıları yalnız sepsis ya da septik şok sürerken görünür,
    ama pencere altta saymaya devam eder (sepsis geri gelirse geçen gerçek süre görünür) ve yalnız
    klinisyen şüpheli enfeksiyonu "yok" olarak işaretleyince biter. Bu işaret 15 dakika içinde
    düzeltilirse (enfeksiyon yeniden "var" işaretlenirse) eski pencere geri gelir — düzeltme aynı
    olaydır; 15 dakikadan sonrası yeni bir pencere başlatır (yeni bir enfeksiyon eski pencereyi ve
    o sırada verilmiş dozları devralmaz).
- *Şüpheli enfeksiyon — ekranın yazdığı iki şeyden biri* (öteki hastanın normali, 3.7): Motorun sepsis kuralı yalnız şüpheli enfeksiyonu
  "var" diye işaretlenmiş hastada çalışır; kimse işaretlemediyse ekran bunu açıkça söyler ("kimse
  işaretlemedi — sepsis kuralı bu hastada hiç çalışmıyor"), yani sakin bir hasta güven verici
  sayılmaz. `clinical.chart` yetkisi olan klinisyen "Var olarak işaretle" ya da "Yok olarak
  işaretle"ye basar. Ekran hiçbir yanıtı önermez ya da önceden seçmez, ikisini de her zaman sunar
  (yargı değişebilir; "var"dan sonra "yok" bir klinik olaydır, geri alma değil) ve basmadan önce
  bunun klinisyenin adıyla ve saatiyle denetim kaydına yazıldığını, geri alınamadığını, yalnız yeni
  bir işaretlemenin üstüne yazdığını söyler. Kayıttan sonra motor hastayı yeniden değerlendirir ve
  ekran onun yeni hâlini gösterir. Yetkisi olmayana düğme çizilmez, nedeni yazılır. SOFA formunu
  doldurup imzalamak sonraki grupta.
- *Göstermedikleri:* yaş, vücut yüzey alanı, hasta kimliğinden uydurulmuş hastane ya da protokol
  numarası, simüle monitör dalgası ve hemşirelik risk skorları. Vital eğrileri artık motorun
  kaydından çizilir (3.7).
- *Panoda olmayan bir hasta:* Adres panonuzda olmayan bir kimliği gösteriyorsa ekran tek bir şey
  söyler: ya böyle bir kayıt yok ya da kapsamınız dışında — ikisi ayırt edilemez, sunucu ikisine
  de bilerek aynı yanıtı veriyor (farklı bir yanıt hastanın orada yattığını ele verirdi). Pano
  okunamadıysa bunu söyler. Açılan her hasta denetim kaydına bir "görüntüleme" satırı bırakır;
  gösterilemeyen bir hasta için hiçbir şey yazılmaz.

**Klinisyenin soracağı üç şey**
1. **"Risk 'Düşük' yazıyor ama yanında 'Bir parametre 3 puan aldı' var — hangisi doğru?"** İkisi de
   motorun. Motor, puan alan her parametreyi hastanın kayıtlı kronik normali ya da kayıtlı bir eşlik
   eden hastalığı açıklıyorsa NEWS2 uyarısını düşürür (4. bölümdeki hastaya göreli katman). Ekran
   düzeyi de olguyu da gösterir, birini ötekine tercih etmez; yanındaki "Hastanın kendi normaline
   göre beklenen" hapı motorun açıklamasını taşır, hasta ekranında açıklamanın kendisi yazar.
   Kırmızı parametrenin düşürmeyi engellemesi gerekip gerekmediği **açık bir klinik karardır**:
   kasada bir kaynak ve bir klinisyenin onayını bekliyor (yol haritası, kullanıcı kararı 9). O
   zamana dek ekran karar vermez, iki olguyu birlikte gösterir.
2. **"Kapanan alarm nereye gitti?"** Panodan düştü. Bir alarm, kuralı onu üretmeyi bıraktığı ilk
   ölçümde kapanır — bekleme süresi yok (G2-A1, O17'nin kararı, 25.10.2026). Tek istisna:
   **kimsenin onaylamadığı kritik bir alarm** durumu geçince de her yüzeyde (alarm listesi, yatak
   kartı, yatak listesi, zil, hasta ekranı) «geçti · onaylanmadı» olarak kalır, sesi durur; biri
   onaylayınca kalkar. Onaylanmış bir kritik alarm ile yüksek, orta ve düşük alarmlar kuralla
   birlikte gider. Aynı alarm yeniden çıkarsa yeni bir bölümdür: yeni ilk görülme anı (eğride yeni
   ▲) ve — aciliyeti «anında» olan alarmlarda — hemşireye yeni bildirim; gidip gelen bir değer
   (nabız 140 → 80 → 140) her dönüşünde yeniden bildirir, bunun için bilerek bir bekleme yok.
   Kimsenin onaylamadığı bir kritik alarm «geçti · onaylanmadı» durumundayken yeniden çıkarsa
   aynı bölümdür, yeni bildirim getirmez (O5). Kimsenin cevaplamadığı bir alarmın eskalasyon saati
   kapanmayla sıfırlanmaz: dönüş eskalasyon süresi (5 dk) içindeyse önceki bölümün saati sürer ve
   doktor yeniden çağrılmaz; daha uzun bir aradan sonraki dönüş, ya da onaylanmış bir bölümden
   sonraki her dönüş, yeni bir saat başlatır (G2-A1 X13). Motor yalnız açık alarmları
   gönderiyor ve alarm geçmişi için henüz bir uç yok; kapanma kaydı denetim kaydında
   (`alert_cleared`; `audit.view` ister).
   Ekran boş bir "kapananlar" bölümü çizmez — boş bölüm "hiçbir şey kapanmadı" diye okunurdu —
   bunu tek cümleyle söyler.
3. **"Vital eğrileri nerede?"** Hasta ekranının altında, "Vital eğrileri" kutusunda (Grup 2 ·
   dilim 1, 3.7). Eğriler motorun kaydettiği ölçümlerdir; tarayıcı hiçbir değeri, bandı ya da
   puanı kendisi hesaplamaz.

### 3.7 Vital eğrileri (hasta ekranı · Grup 2, dilim 1)

Hasta ekranının "Vital eğrileri" kutusu motorun bu hasta için kaydettiği ölçümleri çizer. Kural
Grup 1'inkidir: **ekran çizer, puanlamaz.** Her bant, her NEWS2 puanı, her "hastanın normalinde"
yargısı ve her "öncekine göre" farkı motordan gelir (`GET /patients/{id}/trends`); tarayıcı
bunların hiçbirini hesaplamaz. Homunculus tanı koymaz; eğriler de koymaz.

**Ne gösterir**
- Altı kart: nabız, solunum, SpO₂, sistolik + MAP (bir kart, iki seri; MAP'in noktaları içi boş),
  vücut sıcaklığı, laktat. Her kartta son değer, bir önceki ölçüme göre fark ("↑ +6"), ölçümün ne
  kadar önce yapıldığı (sunucunun saatiyle) ve son 24 saatin küçük grafiği.
- **Çerçeve ve rozet motorun NEWS2 puanıdır:** o parametrenin son değeri 1–2 puan aldıysa amber,
  3 puan aldıysa kırmızı çerçeve; ikisinde de puanı yazan rozet ("NEWS2 +2", "NEWS2 +3"). MAP ve
  laktat NEWS2 parametresi değildir: laktat kartının çerçevesi yoktur, sistolik + MAP kartınınki
  yalnız sistoliğin puanıdır.
- **"Hastanın normalinde" hapı:** son değer bu hasta için girilmiş aralığın içindeyse. Hap çerçeveyi
  susturmaz, çerçeve de hapı gizlemez — iki olgu birlikte gösterilir.
- Karta basınca büyük grafik: 6 saat / 24 saat / 3 gün; imlecin altındaki ölçümün saati, değeri
  ve birimi; ▲ bir alarm bölümünün başladığı an (G2-A1'den beri bir alarm kuralı susunca kapanır;
  yeniden çıkarsa kendi ▲'sı olan yeni bir bölümdür — lejant «alarmın başladığı an» der),
  ◆ kaydedilmiş antibiyotik dozu; aynı sayıların tablosu,
  her ölçümün motorun verdiği NEWS2 puanıyla. Klavyeyle de gezilir; ekran okuyucu okumayı yalnız
  klavye hareketinde duyar.
- Noktalar ölçümdür; aralarındaki kesikli çizgi yalnız aradaki zamandır, ölçüm değildir.

**Bantlar nereden gelir**
- NEWS2 bantları motorun puanlamada kullandığı tablonun kendisidir (`rules/news2.py`
  `NEWS2_BANDS`); kaynağı kasadaki `news2-rcp-2017` notu (kasadaki kopya tam metin değil,
  alıntıdır — `capture: extract`). Yalnız yetişkin, SpO₂ için yalnız Ölçek 1. Profilde yaş grubu
  olmadığından motor her hastayı — bir yenidoğanı da — bu yetişkin tablosuyla puanlar; ekran da aynı
  bantları ve çerçeveleri her hastada "NEWS2 · yetişkin" etiketiyle çizer. Yenidoğan için kaynaklı
  bir bant yoktur — bu boşluk kasada kayıtlı, ekranda başka bir bantla kapatılmaz.
- "Hastanın normali", `clinical.chart` yetkisi olan birinin bu hasta için girdiği aralıktır. NEWS2
  puanı alan bütün değerler bu aralıklardaysa bulgu gösterilir ama alarm vermez; aralığın dışına
  çıkan değer ayrıca bildirilir. Cihazın kendi alarm sınırları Aşama B'de
  doğrulanınca eklenecek; şimdilik yoktur.

**Ne göstermez:** dalga formu (ECG vb.) — prototiptekiler sentetikti; Aşama A'nın monitör
değerleri (geçmiş tutulmuyor, doğrulanmadı, hastaya bağlanmadı); MAP ve laktat için kişisel normal
(motor tutmuyor).

**Çok veri olunca:** bir kanalda pencerede 2 000'den çok ölçüm varsa motor seyreltir — eşit
zaman dilimlerinin her birinde ilk, son, en düşük ve en yüksek ölçüm kalır, yani en kötü değer
kaybolmaz — ve gösterge "‹kanal› seyreltildi: N noktadan M" der. Bugünkü aralıklı ölçümler bu sınıra
yaklaşmaz.

**Hastanın normali (form):** `clinical.chart` yetkisi olan klinisyen kutunun başlığındaki
"Hastanın normali…" ile beş vital için alt ve üst sınır girer. İki sınır da gerekir; alt üstten
büyük olamaz. Motor gönderilen kümeyi bütünüyle yeniler: boş bırakılan aralık silinir,
komorbiditeler ve bazal SOFA değişmez. Form açıldığı hastanındır: başlığında yatak yazar, başka hastaya
geçilince kapanır. Form açıkken aralıklar başka bir yerden değişirse form bunu dakikalık
yenilemede fark eder, söyler ve yeniden açılana dek Kaydet'i tutar; aynı dakika içindeki iki
kayıttan sonraki yine sessizce kazanır (plandaki O3). Kayıtlı bir aralık varken bütün satırlar boşaltılırsa form bunu
söyler ve Kaydet hepsini siler; silme denetim kaydına yazılır ve sunucu yeniden başlasa da geri
gelmez. Kayıt açık alarmları yeniden hesaplamaz: eğrideki bant ve "Hastanın normalinde" hapı
hemen yenilenir, alarmlar ise sonraki ölçüme dek eski hâlinde kalır; sonraki ölçüm yeni normale
(ya da normalsiz) göre değerlendirilir. Kayıt bildirimi de tam bunu söyler: "<yatak>: hastanın
normali kaydedildi; sonraki ölçüm bu aralıklarla değerlendirilecek" (kullanıcı kararı 21.10,
plandaki X21/O12; motorun kayıtta anında yeniden yargılaması ayrı bir iş olarak sonraya kaldı).
Bu aralık monitörün alarm sınırı değildir; motor bu hastanın
değerlerini yorumlarken (4. bölümdeki hastaya göreli katman) bu normali kullanır. Reddedilen bir
kayıt yatağın adıyla bildirimde söylenir; sunucu yanıt vermezse kaydın gerçekleşmiş olabileceği
söylenir ve eğri yeniden okunur.

---

## 4. "Neden bunu kullanmıyoruz" köşesi

Projenin en öğretici kararları. Bir şeyi *yapmamak* da bir tasarım kararıdır.

- **Neden düz eşik-alarmı yetmez?** Klasik monitör sadece "bu değer *şu an* sınırda mı?" diye
  sorar. Oysa tehlike üç yerde saklıdır: **eğilim** (değer normal içinde ama sürekli kötüye
  gidiyor), **doku** (kalp hızı değişkenliği gibi), ve **birliktelik** (birkaç sinyalin birlikte
  hareketi). Eşik alarmı bu üçünü de göremez — tasarımı gereği kördür.

- **Neden qSOFA ile tarama yapmıyoruz?** Duyarlılığı %24; hastaların dörtte üçünü kaçırır.
  Tarama aracı kaçırmamalıdır. (Detay yukarıda.)

- **Neden sabit eşikler (ör. NEWS2) tek başına yetmez — "normal" hastaya özeldir.** (Sizin
  ilettiğiniz doktor görüşü.) Aynı sayı bir hastada normal, ötekinde tehlike: **kronik AF'li**
  hastada nabız 100-110 normalse alarm çalmamalı, ama **anamnezinde AF yokken akut AF'ye giren**
  hastada çalmalı (ikinci inmeyi tetikleyebilir); **kronik hipertansiflerde** tansiyonun 90-100'e
  *düşmesi* önemliyken, bazali zaten 90-100 olan için normaldir. Bu yüzden alarmı **hastanın kendi
  bazaline + yandaş tanılarına** göre değerlendiren bir katman gerekir; kronik-normali bastır, akut
  değişimi öne çıkar. Bu, motora **yatış tanıları (komorbiditeler)** ve **bazal vital profili** gibi
  yeni girdiler ister. **Artık kuruldu:** klinisyenin girdiği hasta profili (komorbidite + bazal
  aralıklar) motorda `patient-relative` katmanını besliyor — her puanlayan vital hastanın charted
  bazı içindeyse uyarı "Beklenen (kronik)" diye **indirgenir** (görünür kalır ama alarm/eskalasyon
  yapmaz), bir vital bazın *dışına* çıkarsa **akut değişim** uyarısı doğar. Eşiği biz icat etmeyiz —
  **hep klinisyenin girdiği aralıktır**. (Vault: `patient-relative-alerting`.)

- **Neden hazır bir ML modeline körü körüne güvenmiyoruz?** Çünkü şiddet skorları kısmen
  *doktorun tepkisini* ölçer (örn. vazopresör dozu, doktor hastanın kötüleştiğini fark edince
  artar). Bu özelliklerle eğitilen model "geçmişi tahmin etmeyi" öğrenir: test setinde harika
  görünür, gerçekte işe yaramaz. Bu yüzden model eklerken "müdahale özelliklerini çıkarıp
  yeniden ölç" testi şarttır.

- **Neden NICU'ya yetişkin/çocuk tanımını uygulamıyoruz?** Prematüre bir bebekte solunum ve
  dolaşım dalgalanması *zaten normaldir*; yetişkin skoru burada neredeyse tüm bebekleri "hasta"
  işaretler. NICU ayrı bir üründür.

- **Neden cihazın özel protokolünü (WACP) kendimiz yazmadık?** Pilot monitörü köprümüze
  yönlendirdiğimizde HL7 yerine anlaşılmaz 37 bayt geldi — içinde `RNDZCONNECT` yazıyordu:
  Welch Allyn'in kapalı protokolü WACP'nin selamı. İlk akla gelen "o zaman WACP'yi biz yazalım"
  oldu. Yazmadık, çünkü iz sürünce daha iyisi çıktı: cihazın içine yazılı IP'nin sahibi,
  hastanede **2020'den beri çalışan gerçek bir NCE sunucusuydu** — cihazların aradığı muhatap
  zaten oradaydı ve her ölçümü diske XML olarak yazıyordu. Üç yol vardı: (A) NCE'den HL7 çıkışı
  ayarlatmak, (B) NCE'nin yazdığı dosyaları okumak, (C) WACP'yi sıfırdan yazmak. **B'yi seçtik:**
  beş yıldır dört cihazın bağlı olduğu canlı klinik bir sisteme hiç dokunmadan, salt-okunur bir
  paylaşımla veri alıyoruz. C ise spec'i olmayan tescilli bir protokolü tersine mühendislikle
  yazmak demekti — aylar sürer ve klinik veride en tehlikeli hata sınıfını (sessizce *yanlış*
  çözümlenen değer) davet eder. Ders: **cihaz konuşmuyorsa önce kiminle konuşmaya çalıştığını
  bul** — sorunun cevabı çoğu zaman protokol yazmak değil, zaten çalışan bir sistemi bulmaktır.
  (Bonus bulgu: sunucunun Windows saati, dosya adlarındaki UTC damgasından bir saat farklıydı.
  Bu yüzden köprü yerel saate asla güvenmez: ya dosyanın içindeki UTC zamanı, ya dosya adındaki
  UTC damgası — saat dilimi belirtmeyen bir zaman *reddedilir*, asla "yereldir" diye varsayılmaz.)

- **Neden gerçek hasta verisini bu depoya koymuyoruz?** Asla PHI (hasta kimlik bilgisi) girmez.
  Model için ya sentetik ya da halka açık de-identifiye veri (MIMIC-IV/eICU) kullanılır. Bu
  hem yasal zorunluluk hem de güvenin temeli.

---

## 5. İlerledikçe eklenecekler

Bu bölüm proje büyüdükçe dolacak. Şu an sıradaki terim grupları:

- **Ventilatör / solunum terimleri** — PEEP, tidal hacim, plato basıncı, ARDSnet,
  weaning/ekstübasyon, kan gazı (ABG) yorumlama.
- **Cihaz bağlantı terimleri (MEDIBUS köprüsü kuruldu — `medibus/`):**
  - **MEDIBUS:** Dräger'in **ventilatör ve anestezi cihazlarının** (Evita, Savina, V500, Primus…)
    arka COM portundan konuştuğu eski ama sağlam seri (RS-232) protokolü. Bilgisayar 2 saniyede bir
    "ölçümleri ver" der, cihaz SpO2, nabız, solunum sayısı, FiO2, PEEP gibi kodlu değerlerle cevap
    verir. Köprü yalnızca *okur*; ayar değiştirmez, alarm susturmaz.
  - **Kappa ≠ MEDIBUS:** Yoğun bakımdaki Infinity Kappa başucu monitörleri vital verisini MEDIBUS
    ile *vermez*; onların seri çıkışı ayrı bir protokoldür (*Infinity RS-232 Export Protocol*, X5
    konektörü). Kappa'daki "MEDIBUS" özelliği ventilatör verisini monitöre *almak* içindir. Yani
    MEDIBUS köprüsü ventilatöre takılır, monitöre değil.
  - **Keşif modu:** Köprüyü hiçbir veri iletmeden çalıştırıp cihazın *hangi kodları* gönderdiğini
    görmek. Eşleme tablosu (mapping) bu rapordan yazılır, kılavuzdan değil.
  - **Loopback testi:** Adaptörün 2-3 pinlerini ataşla köprüleyip gönderdiğini geri alması.
    Ventilatöre dokunmadan "adaptör, sürücü, COM numarası doğru mu?" sorusunu cevaplar.
  - **Null-modem:** İki bilgisayar-tarafı cihazı (ventilatör ve laptop) birbirine bağlayan, 2 ile 3
    numaralı telleri çapraz geçen kablo. Düz kabloyla hiçbir şey gelmez.
  - **STOP kuralı:** Programı kapatmadan kabloyu çekersen ventilatör 3 saniye sonra ekranda ve
    sesli "iletişim hatası" verir. Önce Ctrl+C, sonra kablo.
  - **Infinity Gateway:** Dräger'in yoğun bakım monitör ağından (Infinity Kappa başucu
    monitörleri) HL7 çıkarmak için gereken ayrı bir yazılım. Hastanede kurulu olup olmadığı henüz
    bilinmiyor — biomed'e sorulan sorular `docs/drager-infinity-biomed-sorulari.md`'de. Varsa,
    hiç yeni kod yazmadan mevcut MLLP köprüsü (`run_bridge.py`) kullanılır; yoksa Kappa'nın kendi
    seri protokolü (MS28819, X5 konektörü — MEDIBUS'tan farklı) bir sonraki seçenek olur.
  - **Aşama A şeridi (19 Ekim 2026'dan beri canlı):** Gateway beklenmeden, kendi çözücümüzün
    okuduğu 13 Kappa monitörünün değerleri klinik panoda "Monitör · doğrulanmamış" başlıklı kesik
    çizgili bir şeritte görünür. Yalnız görüntüdür: alarm, skor, bildirim, ses üretmez; motor bu
    değerleri hiç görmez (kabulde pano özeti değişmedi, denetim kaydına 0 satır düştü). Bütün
    klinisyenler görür; biyomedikal ayrıca "Monitörler" ekranında cihazları hasta bilgisi olmadan
    görür. Kapatma üç kademe: **G-1** forwarder kapalı (hub'da drop-in 93 silinir; saniyeler
    sürer; şerit "Monitör verisi gelmiyor" der), **G-2** aşama kapalı (API `.env`'de
    `INFINITY_CLINICAL_STAGE=off`; şerit tamamen kalkar), **G-3/G-4** kod geri. Cihaz→yatak
    tablosu (`deploy/local/infinity-shadow/device-beds.json`, sürüm 1, sha `ac5ce1c9549c`)
    19.10'da proje sahibince merkezi monitörün yatak listesinden onaylandı; değişiklik yeni bir
    sürüm olarak aynı yolla onaylanır. Ayrıntı ve kabul ölçümleri: `deploy/infinity/README.md`,
    "Aşama A" bölümü.
- **ML terimleri (ilk model kuruldu — [[early-sepsis-ml-model]]):**
  - **Etiket (label):** modele "doğru cevap" olarak verdiğimiz şey. Bizde: hasta 6 saat *sonra*
    sepsis olacak mı? (PhysioNet verisi bunu hazır işaretlemiş.)
  - **Time-zero (sıfır anı):** "erken" derken neye göre erken? Sepsisin başladığı an; model onu 6
    saat öncesinden yakalamaya çalışır.
  - **Sızıntı (leakage):** aynı hastanın bir saatini eğitime, başka saatini teste koyarsan model
    "kopya çeker" ve testte sahte-iyi görünür. Bu yüzden ayrımı **hasta bazında** yaparız.
  - **AUROC:** modelin sıralama başarısı (0.5 = yazı-tura, 1.0 = kusursuz).
  - **Kalibrasyon:** model "%20 risk" dediğinde gerçekten 100 hastadan ~20'si mi oluyor? Sayı
    dürüst mü? (Brier skoruyla ölçeriz.)
  - **Ablasyon:** tedaviyle ilgili özellikleri çıkarıp yeniden ölçmek — model hastanın fizyolojisine
    mi yoksa "doktorun tepkisine" mi dayanıyor anlamak için (Epic Sepsis Modeli dersi).
  - Model kurallardan sonra, onların **yanına** `sepsis_watch` diye eklenir; asla yerine geçmez,
    tanı koymaz — sadece "erken bak" der.

*(Not: Canlı panel — hasta listesi, canlı alarmlar, onay ve eskalasyon — B1+B2 dilimleriyle
kuruldu ve çalışıyor; "Panel/ürün terimleri" artık gerçek. NEWS2 hem vault'ta hem motorda; hastaya-
göreli / komorbidite katmanı kuruldu; **küçük ML modeli (erken sepsis) ilk dilimi de kuruldu** —
eğitim+değerlendirme boru hattı + motora `sepsis_watch` ek-sinyali; **B3 bildirim iletimi de kuruldu**
— yeni acil uyarı hemşireye, eskalasyon doktora; tarayıcıda toast + masaüstü bildirim + ses, rol-filtreli
`/notifications` akışıyla, PHI sistemden çıkmadan. Sıradaki iş: modeli gerçek PhysioNet verisiyle
eğitmek. **B4 audit dilimi de kuruldu** — her olay (gözlem/uyarı/onay/eskalasyon/bildirim) SQLite'a
ekle-sadece, DB-trigger'ıyla **değişmez** yazılır; kiracı-kapsamlı `/audit` ile okunur. Sıradaki B4
parçaları: gerçek Postgres, çok-süreçli pub-sub. Ek olarak: durum kalıcılığı (audit-replay ile
restart'tan sağ çıkma), first_seen kalıcılığı, KOAH-oksijen için komorbidite-farkındalıklı NEWS2,
`view` denetimi, panoda bayat-veri rozeti ve bildirim geçmişi paneli de kuruldu. **Mobil eşlikçi
uygulama (M1) da kuruldu** — Expo/React Native, kayıtlı üç yataklı koğuşu oynatan bir aktarım katmanı
üzerinde: riske göre sıralı hasta listesi, vital kartları ve senaryo zamanı eğilimleri, kasadaki
kaynak notlarına bağlanan kılavuz çekmecesi, eskalasyon farkındalıklı titreşim. M2 ile canlı bağlantı
da kuruldu — telefon, web panosunun bağlandığı sunucuya JWT girişi ve tek kullanımlık SSE biletleriyle
bağlanır; oturum düşerse gösterime döner. M6 ile uygulama, kullanıcının gösterdiği Figma Medical UI Kit dilinde baştan giydirildi — beyaz zemin, `#2260FF` mavi, hap biçimli her şey, League Spartan yazı tipi, yüzen mavi gezinme çubuğu; gece skini aynı formları lacivert zeminde korur ve Ayarlar'dan seçilir. **MEDIBUS ventilatör
köprüsü (`medibus/`) de kuruldu** — ayrı klasör, USB'den çalışır, sahte cihazla 86 testi geçer;
biyomedikal onayıyla tek ventilatörde denenecek.)*

> Bir terimi merak edip burada bulamazsan, söyle — hem cevaplarım hem de bu dosyaya eklerim.
