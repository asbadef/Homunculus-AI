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
- *Homunculus'ta:* 29 sabit anahtar (`board.view`, `alerts.ack`, `users.manage`, `groups.manage`…; en yenisi
  `quality.view`, «Kalite göstergeleri», §3.25).
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
  Yöneticisi. Panoyu görmeyen ama kullanıcı ya da grup yöneten biri **Yönetim**'e. Panoyu görme ve
  yönetim yetkisi olmayan ama cihaz yönetimi yetkisi (`devices.manage`) olan biri — varsayılan
  gruplarda Biyomedikal Teknisyen ve Üretici Destek — **Cihazlar**'a («Cihaz & Veri Akışı», aşağıda
  3.22); Üretici Destek'in menüsünde ikinci sırada «Denetim bütünlüğü» de vardır (3.13). Yetkileri
  yeni arayüzün hiçbir ekranını açmayan bir hesap içeri alınmaz; giriş ekranı bunu söyler
  ("Hesabınızın yetkileri bu arayüzdeki ekranlardan hiçbirini açmıyor. Sistem yöneticinizle
  görüşün."). **Ayarlar**
  herkese açık, menünün en altında. Bir yer imiyle ya da bağlantıyla açılan adres girişten sonra
  bir kez kullanılır — kişi o ekranı açabiliyorsa; bir **hastanın** adresi ise girişten sonra
  açılmaz, ana ekrana düşülür (kilit açılınca olduğu gibi: yukarıda "Kilit ekranı").
- *Bağlantı canlı mı:* Sunucu, pano akışında hiçbir şey olmasa da 15 saniyede bir "yaşıyorum"
  işareti gönderir; 45 saniye hiç ses gelmezse tarayıcı bağlantıyı kopmuş sayar, yeniden bağlanır
  ve o sırada sayıları "güncel olmayabilir" diye işaretler. Böylece yarı kopmuş bir bağlantı
  "sakin servis" gibi okunmaz.
- *Akışın ömrü (sahip kararı, 2026-11-10, «Süre sınırı»):* Sunucu her pano ve bildirim akışını en
  geç 15 dakikada bir kendisi kapatır (`rotate`). Kişinin birim kapsamı akış açılırken bir kez
  okunur; bu kapanış sayesinde birimi değişen bir hemşirenin ya da düzenlenen bir yapının ekranı
  en geç 15 dakikada yeni kapsama geçer. Tarayıcı hemen yeni bir biletle bağlanır ve panoyu
  yeniden yükler; bu planlı bir yenilemedir, ekranda "güncel olmayabilir" şeridi çıkmaz.
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
  Homunculus'un kendi kabul ekranından taburcu edilen hasta bütün panellerden bir anda çıkar; açık
  alarmları «taburcu» nedeniyle kapanır (G2-A11). O numara için bir monitör ölçüm göndermeyi
  sürdürse bile hiçbir alarm, çağrı ya da kart doğmaz. Düşürülen her ölçüm denetim kaydında ayrı bir satır olarak görünür
  (olay türü `reading_dropped_discharged`; ekranda henüz Türkçe bir etiketi yok); ölçümün değeri o
  satıra yazılmaz.
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
  ve yetkiler, Giriş kaynağı ("İstifadəçilər", "Rollar və səlahiyyətlər", "Giriş mənbəyi"); G2-B1a
  dördüncüsünü ekledi: Yapı ("Struktur", `structure.manage`; aşağıda 3.8).
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
    seçenekler G2-B1a'dan beri koğuşun yapısından gelir — her birim adıyla, her yatak "etiket ·
    oda · birim" olarak, hastası olmayan boş bir birim de — ve ayrıca panodaki kartlardan ve
    kişinin mevcut atamalarından; elle anahtar yazma kutusu kalktı, aynı yer iki kez verilemez
    (3.8). Kapsamı yalnız kendi kapsamı **rolü gereği** sınırsız olan yönetici (Sistem Yöneticisi
    ya da platform operatörü) kaydedebilir; `users.manage` tek başına yetmez. Ataması olmayan bir hesap bugün
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
    **Eski veri skora girmez** (G2-A2): penceresini aşmış bir ölçüm — solunum, SpO2, sistolik
    basınç ve nabız için 1 saat, ateş için 2 saat — toplama girmez, skor "kısmi" olur ve kartta
    hangi girdinin ne kadar eski olduğu yazar ("eski veri: SpO2 · 2 sa önce"; yaşı ekran söyler,
    "eski"ye motor karar verir). Yeni ölçüm gelmese de kart güncellenir: pencere kapanınca pano en
    geç ~20 saniye içinde yeniden gönderilir. Alarm da aynı skoru kullanır: eski bir ölçüm artık
    NEWS2'yi alarm bandına çıkaramaz. Çalışan bir NEWS2 alarmını da eski girdi bitiremez: alarm
    son puanlandığı gibi kalır, eski bir değerle yükselmez; eski değerlerin hâlâ ulaştığı daha
    düşük banda iner, hiç yukarı çıkmaz; okumalar — eskiler son değerleriyle sayılarak — bandın
    altına inince biter. Süresi dolan bir oksijen ya da bilinç kaydı da alarmı eski bir vital gibi
    tutar; tutma sınırsız değildir: girdi eskidikten sonra 8 saat içinde yeniden ölçülmezse alarm
    biter. Saati ileri giden bir cihazın ölçümü öbür okumaları eskitmez.
    **Oksijen ve bilinç kaydedilmemişse varsayılır, söylenerek:**
    oda havası ve uyanık sayılır, kartta «varsayıldı: oda havası, uyanık» hapı çıkar; skor bunun
    için "kısmi" sayılmaz. Kaydedilmiş bir oksijen ya da ACVPU değeri 8 saat (bir vardiya) geçerlidir;
    sonra yeniden varsayılır ve hap son kaydı değeriyle söyler («oda havası (son kayıt: oksijende,
    9 sa önce)», «uyanık (son kayıt: U, 9 sa önce)») — süresi dolan "oksijen alıyor" toplamdan 2
    puan, V/P/U 3 puan düşürür. Pencereler ve 8 saat işletme varsayılanıdır, klinik iddia değildir;
    bir klinik değerlendirme değiştirene kadar böyledir. "Yeni konfüzyon" ayrıca modellenmez:
    ACVPU'da uyanık dışındaki her değer 3 puandır.
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
  Prototipteki 3/5/10 dakikalık basamaklar canlı sistemde yoktur. Elle eskalasyon «RRT çağır»
  (§3.15), erteleme «Ertele» (§3.21) ile geldi.
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
- *Şüpheli enfeksiyon — ekranın yazdığı beş şeyden biri* (ötekiler hastanın normali, 3.7; aşağıdaki vazopressör/sıvı kaydı; SOFA formundan girilen ölçümler; «Ölçüm gir» ile girilen yatak başı ölçümleri, 3.12): Motorun sepsis kuralı yalnız şüpheli enfeksiyonu
  "var" diye işaretlenmiş hastada çalışır; kimse işaretlemediyse ekran bunu açıkça söyler ("kimse
  işaretlemedi — sepsis kuralı bu hastada hiç çalışmıyor"), yani sakin bir hasta güven verici
  sayılmaz. `clinical.chart` yetkisi olan klinisyen "Var olarak işaretle" ya da "Yok olarak
  işaretle"ye basar. Ekran hiçbir yanıtı önermez ya da önceden seçmez, ikisini de her zaman sunar
  (yargı değişebilir; "var"dan sonra "yok" bir klinik olaydır, geri alma değil) ve basmadan önce
  bunun klinisyenin adıyla ve saatiyle denetim kaydına yazıldığını, geri alınamadığını, yalnız yeni
  bir işaretlemenin üstüne yazdığını söyler. Kayıttan sonra motor hastayı yeniden değerlendirir ve
  ekran onun yeni hâlini gösterir. Yetkisi olmayana düğme çizilmez, nedeni yazılır.
- *Vazopressör / sıvı kaydı — ekranın yazdığı üçüncü şey* (G2-A3): `clinical.chart` yetkisi olan klinisyen İlaç ve
  antibiyotik kutusunda «Kayıt ekle»ye basar; açılan pencerede kilo (kg), vazopressör/inotrop (noradrenalin, adrenalin, dopamin,
  dobutamin) ile hızı (µg/kg/dk), kristaloid bolus (mL), «Antibiyotik verildi» ve «Kayıt saati» vardır; her alan
  isteğe bağlıdır, en az biri dolu olmalıdır. **Hız infüzyonun şu anki hızıdır:** değişince yeni bir kayıt girilir,
  **0 «durduruldu» demektir.** Ekran mL/saat ↔ µg/kg/dk çevirmez; hızı µg/kg/dk yazın. Her bolus ayrı bir kayıttır
  (kural son 3 saatin toplamını kendisi sayar). Kayıt saati varsayılan olarak şimdidir; siz değiştirene kadar
  gösterilen saat zamanla birlikte ilerler ve kayıt «Kaydet»e basıldığı anın saatiyle gider (pencere açık kalsa da);
  değiştirdiğiniz saat sizindir, kendiliğinden değişmez. En çok 24 saat geriye gidilir, ileri saat kabul edilmez.
  Kayıttan sonra motor hastayı hemen yeniden değerlendirir; septik şok alarmı da hemen çıkabilir. **Düzeltme yeni
  kayıttır:** yanlış hız ya da kilo doğrusu yeniden girilerek düzelir: kart en son değeri gösterir (kayıt saati yanlış
  kaydınkinden önce olmamak kaydıyla), denetim kaydı hepsini saklar. **Yanlış bolus bu sürümde geri alınamaz:**
  doğrusunu girin, ama kuralın 3 saatlik sıvı toplamı pencere geçene kadar gerçeğinden yüksek okuyabilir. İlaç ve
  antibiyotik kutusu artık her vazopressörü son hızı ve saatiyle («noradrenalin 0.12 µg/kg/dk · 14:05», 0 girildiyse
  «durduruldu · 14:30»; bugünden önceki bir kayıtta saatin önünde gün ve ay da yazar: «25.10 23:40»),
  kiloyu, antibiyotik satırını ve «Son kayıtlar» altında son on girişi (en yenisi üstte) gösterir. Servis duyurusu
  (G1-15) septik şokun vazopressör bilgisi alamadığını söylüyordu; kaydı yapılan vazopressör artık kurala girer —
  kayıt yoksa kural yine bilmez («kimse kaydetmedi» ile «verilmedi» aynı şey değildir).
- *SOFA formu — ekranın yazdığı dördüncü şey* (G2-A4): İlaç ve antibiyotik kutusunun altındaki **SOFA formu** kutusu
  formun toplamını, kaç organda ölçüm olmadığını ve son imzayı gösterir («İmzalandı · dr.elif · 14:05 · toplam 7»;
  düzeltme yapılmışsa sayısı da yazar; bugünden önceki bir imzada saatin önünde gün ve ay yazar) ya da «İmzalanmadı».
  **Bu sayı Sepsis-3 kutusundaki SOFA değildir:** o, son değerlerle hesaplanan alarm SOFA'sıdır; form son 24 saatin
  **en kötü** değerleriyle doldurulur — ikisi aynı sayı olmak zorunda değil. «Formu aç» altı organı kaynaktaki sırayla
  gösterir (solunum, pıhtılaşma, karaciğer, kardiyovasküler, merkezi sinir sistemi, böbrek): her girdinin en kötü
  değeri, birimi, ölçüm saati, kaynağı ve puanı; ölçümü olmayan organda «ölçülmedi» (skor onu 0 sayar, ekran 0
  yazmaz); 3 ve üstü puanda «≥3 puan» işareti (hastanenin basılı formunun dipnotundaki organ yetmezliği eşiği;
  kaynağı henüz bilgi vault'una alınmadı). Hasta 24 saatten kısa süredir buradaysa form bunu söyler.
  **Tamamlama** (`clinical.chart`): trombosit (×10³/µL), bilirubin ve kreatinin (**mg/dL**, laboratuvarın birimi —
  ekran çevirmez; µmol/L yazılmış bir kreatinin 40'ın üstündeyse reddedilir, altındaysa reddedilmez; µmol/L bir
  bilirubin de reddedilmeyebilir: koruma alanın yanında yazan birimdir, birimi oradan okuyun), GCS (tam sayı),
  PaO₂/FiO₂ ve «solunum desteği» (evet/hayır) formdan girilir. Bu bir ölçümdür, gerekçe istemez; ölçüm saati siz
  değiştirene kadar şimdidir, en çok 24 saat geriye gider, ileri gitmez — solunum desteği girilirken ise, satırda
  ölçülmüş bir PaO₂/FiO₂ varsa, saat o ölçümün saatiyle gelir (alanın altında yazar; değiştirebilirsiniz): oranı
  girip ardından «evet»i saate dokunmadan kaydetmek o oranı da destekte saydırır; kayıttan sonra form yeniden
  okunur, puanı motor hesaplar. Solunum desteği: form her PaO₂/FiO₂ ölçümünü **kendi saatinde** geçerli olan destek kaydıyla
  puanlar — ölçümden önceki ya da aynı saatteki son «evet»/«hayır», 24 saatten eski olsa da; destek kaydı yoksa
  destekte sayılmaz — ve satıra pencerenin en kötü **puanını** alır (eşit puanda düşük oran, sonra son ölçüm):
  destekteyken ölçülmüş 180 (3 puan), destek yokken ölçülmüş 150'nin (2 puan) önüne geçer. Ölçümden sonraki bir
  saate girilen kayıt o ölçümü değiştirmez; ölçümden önceki bir saate sonradan girilen bir «hayır» ise geçerlidir.
  Solunum satırı ölçümünün neye göre puanlandığını yazar: «Destekte puanlandı — 07:00 kaydı», «Destek dışı
  puanlandı — 07:00 kaydı» ya da, ölçümün saatinde veya öncesinde destek kaydı yoksa, «Bu ölçümün saatinde (ya da
  öncesinde) destek kaydı yok — destek dışı puanlandı (07:30)». Alarm SOFA'sı ise son kaydı okur
  ve 8 saatten eski bir destek kaydını gerekçesinde «eski» diye belirtir (puanı değiştirmez).
  **Düzeltme** (`scores.sign`): yalnız ölçülmüş bir değere (ölçülmemiş bir değerin düzeltmesini motor da reddeder:
  «ölçülmemiş bir değer düzeltilemez — ölçümü formdan girin»), doğru değer ve en az 20 karakterlik bir gerekçeyle
  (sayaç gösterir); puan yazılmaz, motor yeniden hesaplar, kayıttaki değer de saklanır; yazım hatası sınırları düzeltmede
  de geçerlidir (18000 yazılmış bir trombosit ya da 9000 yazılmış bir MAP hem önizlemede hem imzada reddedilir).
  **Önizle, sonra imzala:** «Önizle» motorun ayrı önizleme yolundan imzalanacak formu ve onun parmak izini ister,
  hiçbir şey yazmaz; «İmzala» yalnız o önizlemeden sonra, aynı düzeltmelerle ve o parmak iziyle çıkar (bir düzeltme
  değişirse yeniden önizlenir; yeniden önizleme reddedilir ya da yanıt alamazsa önceki önizleme de bırakılır),
  çıktıktan sonra kısa bir an basılamaz (hızlı bir çift tıklama imza atmasın diye);
  imza adınızla, önizlemenin parmak iziyle birlikte denetim zincirine mühürlenir. Parmak izi şunları kapsar: hasta,
  pencerenin uzunluğu ve kalış süresinin pencereyi doldurup doldurmadığı, toplam, her organın puanı, her girdinin
  değeri, ölçüm saati, puanı ve pencereden önceki bir ölçüm olup olmadığı, solunum satırının destek kaydı, her
  düzeltmenin değeri, kayıttaki değeri ve gerekçesi. Önizleme ile imza arasında bunlardan biri değiştiyse (başka biri
  ölçüm girdiyse, 24 saatlik pencere bir ölçümün üstünden kaydıysa, imza başka bir gerekçe ya da pencereyle
  gönderildiyse) motor **imzalamaz**: «form önizlemeden sonra değişti (yeni kayıt ya da pencere kayması) — formu
  yeniden önizleyin» der ve hiçbir şey yazmaz; yeniden önizler, gördüğünüzü imzalarsınız — imzalanan sayı her zaman
  önizlenen sayıdır. Parmak izine girmeyenler: pencerenin başlangıç ve bitiş saati (her saniye kayar), bir girdinin
  kaynağı ve pencerede kaç ölçüm bulunduğu (ekranda yazmaz). Önizlemeyi tanımayan eski bir sunucuya karşı form
  düzeltme, önizleme ve imza sunmaz. İmzalanmamış düzeltmelerle form kapatılırsa ekran düzeltmelerin bırakıldığını
  söyler. Formu `board.view` yetkisi olan herkes açabilir; yetkisi olmayana düğme çizilmez, nedeni yazılır.
  **Yapmadıkları:** Formun kendisi alarm üretmez; buradan girilen bir ölçüm hasta kaydına yazılır ve uyarı kuralları
  (Sepsis-3 kutusu) da onu okur. İdrar çıkışı böbrek puanına katılmaz (eksik kaydedilmiş bir günün toplamı oligüri
  gibi okunurdu); MAP formdan girilmez (kayıttan gelir — monitör henüz gerçek motoru beslemediği için çoğu hastada
  «ölçülmedi»); vazopressörler İlaç kutusundan girilir; pencere 24 saattir; dünle karşılaştırma ve skor geçmişi yok;
  APACHE, PRISM ve SNAP tabloları kaynağıyla gelene kadar yok. Formun her okunuşu denetim kaydına bir satır düşer.
- *Göstermedikleri:* yaş, vücut yüzey alanı, hasta kimliğinden uydurulmuş hastane ya da protokol
  numarası, simüle (uydurma) monitör dalgası ve hemşirelik risk skorları. Vital eğrileri artık
  motorun kaydından çizilir (3.7). Gerçek monitör dalgası ayrı, «doğrulanmamış» etiketli bir
  paneldedir (3.11).
- *Panoda olmayan bir hasta:* Adres panonuzda olmayan bir kimliği gösteriyorsa ekran tek bir şey
  söyler: ya böyle bir kayıt yok ya da kapsamınız dışında — ikisi ayırt edilemez, sunucu ikisine
  de bilerek aynı yanıtı veriyor (farklı bir yanıt hastanın orada yattığını ele verirdi). Pano
  okunamadıysa bunu söyler. Kapsamınız o an okunamıyorsa (veritabanı yanıt vermiyor) sunucu
  "bulunamadı" demez, "kapsam şu anda okunamıyor" der ve denetim kaydına bir kapsam ihlali yazmaz
  (G2-A2); pano da "Sunucuya bağlantı yok" şeridini gösterir. Açılan her hasta denetim kaydına bir
  "görüntüleme" satırı bırakır; gösterilemeyen bir hasta için hiçbir şey yazılmaz.

**Klinisyenin soracağı dört şey**
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
4. **"Taburcu edilen hastanın alarmları ve ölçümleri ne olur?"** Homunculus'un kendi kabul
   ekranından taburcu edilen hasta (kimlik kaynağı `kabul`) alarm dünyasından çıkarılır (G2-A11):
   taburcu yolu `app.state.retire_patient`'ı çağırır; her açık alarm, nedeni `discharged` olan bir
   `alert_cleared` satırıyla kapanır, onay ve eskalasyon durumu ile motorun hasta durumu unutulur,
   servise tek bir kaldırma çerçevesi gider. O numaranın sonraki ölçümleri `/ingest` ve `/clinical`
   kapısında motordan önce düşer: HTTP 200 `{"patient_id", "dropped": "discharged"}`, ölçüm başına
   bir `reading_dropped_discharged` denetim satırı (konu sinyal kodu, değer yok); alarm, çağrı ya da
   çerçeve doğmaz. Eskalasyon döngüsü böyle bir hasta için çağrı yapmaz — retire çağrısı hiç
   gelmediyse alarmı kendisi kapatır; yeniden başlatma da kimlik deposuyla uyuşur (tekrar oynatma
   `discharged` nedenli satırı uygular, sonra motor bir kez kimlik deposuna karşı taranır). HIS
   (Comed) taburcusu değişmez: kartı 24 saat kalır, ölçümleri değerlendirilmeye devam eder.
   `/ingest` kimlik iletilerine iki yeni yanıt verir: `meta.source` değeri `kabul` olan bir kimlik
   400 ile reddedilir; var olan bir `kabul` kaydı için gelen HIS ya da elle kimlik iletisi 200
   `{"identity": "refused", "reason": "kabul"}` alır — `kabul` kaydını yalnız kabul ekranı yazar.

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
- Elle girilen değerler «elle» diye işaretlenir; geri alınmış olanlar üstü çizili kalır (bkz. 3.12).

**Bantlar nereden gelir**
- NEWS2 bantları motorun puanlamada kullandığı tablonun kendisidir (`rules/news2.py`
  `NEWS2_BANDS`); kaynağı kasadaki `news2-rcp-2017` notu (kasadaki kopya tam metin değil,
  alıntıdır — `capture: extract`). Yalnız yetişkin, SpO₂ için yalnız Ölçek 1. Profilde yaş grubu
  olmadığından motor her hastayı — bir yenidoğanı da — bu yetişkin tablosuyla puanlar; ekran da aynı
  bantları ve çerçeveleri her hastada "NEWS2 · yetişkin" etiketiyle çizer. Yenidoğan için kaynaklı
  bir bant yoktur — bu boşluk kasada kayıtlı, ekranda başka bir bantla kapatılmaz.
- "Hastanın normali", `clinical.chart` yetkisi olan birinin bu hasta için girdiği aralıktır. NEWS2
  puanı alan bütün değerler bu aralıklardaysa bulgu gösterilir ama alarm vermez; aralığın dışına
  çıkan değer ayrıca bildirilir. Cihazın (monitörün) kendi alarm sınırları ayrı ve daha sonraki
  bir iştir — buradaki Aşama B'nin (gölge motor) parçası değildir; şimdilik gösterilmez.

**Ne göstermez:** dalga formu (ECG vb.) — prototiptekiler sentetikti; gerçek dalga ayrı,
doğrulanmamış bir paneldedir ve bu eğrilere girmez (3.11); Aşama A'nın monitör
değerleri (geçmiş tutulmuyor, doğrulanmadı, hastaya bağlanmadı; Aşama B açılırsa dakikalık
monitör örnekleri 30 gün saklanır, ama bu eğrilere yine çizilmez); MAP ve laktat için kişisel
normal (motor tutmuyor).

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

### 3.8 Hasta Kabul (Grup 2 · B1a)

Bu dilimden önce hiçbir ekran "bu hasta bu yatakta yatıyor" diyemiyordu: kabul kayıtları ile
pano iki ayrı dünyaydı ve hiçbir şey onları bağlamıyordu. **Artık Homunculus'ta yapılan kabul,
hangi hastanın hangi yatakta yattığının asıl kaydıdır** (kullanıcı kararı D1); HBYS akışı
geldiğinde yalnız formu önceden dolduracak. Bu ekranlar kimin hangi yatakta yattığını ve hastanın
nereye gittiğini kaydeder; klinik bir karar vermez, hiçbir klinik değer hesaplamaz. Örneklerdeki
numaralar ve yerler uydurmadır.

**İki sekme** — menüde "Hasta Kabul" (B3a'dan önce üçüncü sekme «Yataklar»dı; artık ayrı «Doluluk»
ekranı, bkz. 3.14):
- **Kabul:** yeni hastayı yatırma formu. *Kimlik:* soyad ad\* (koğuşun yazdığı sırayla), baba adı, cinsiyet\*, doğum
  tarihi\* (yaş kendiliğinden yazılır), uyruk, FİN (7 harf ya da rakam), pasaport, telefon.
  *Kabul:* kabul türü\*, kaynak, kabul tanısı\*, kilo, boy, kan grubu, bilinen alerji ya da
  "Bilinen alerjisi yok"\* (ikisinden biri), eşlik eden hastalıklar, HBYS protokol no. *İletişim ve
  onam:* yakını, refakatçi, onam\* ("Kişisel veri onayı imzalandı" ya da "Bilinci kapalı — onam
  sonra alınacak"), SMS izni. *Yatak\*:* önce birim, sonra oda ve yatak; yalnız boş ve açık yatak
  seçilir, dolu, temizlikteki ve kapalı yataklar soluk ve nedeniyle görünür. Sağdaki "Eksik
  alanlar" paneli eksik her zorunlu alanı adıyla söyler; panel boşalmadan kabul gönderilmez.
  Form yarıda bırakılıp başka bir sekmeye ya da ekrana geçilse de kaybolmaz; onu "Yeni kabul" ya
  da oturumun kapanması temizler.
- **Nakil / Taburcu** (B1b'den önce yalnız «Taburcu»): iki liste — "Taburcusu başlatılan"
  (sorumlu hemşirenin onayını bekleyenler) ve "Yatan hastalar". İmzalı her yatan hastanın satırında
  «Nakil» ve «Taburcuyu başlat» düğmeleri durur (3.20).

**Kim ne yapar** (hastanenin varsayılan grupları; gruplar Yönetim › Roller ve yetkiler'de
değiştirilebilir):

| İş | Kim | İzin |
|---|---|---|
| Kabul et | Hemşire, Sorumlu Hemşire | `admissions.admit` |
| Kabulü imzala (hasta ekranından; hekim adı geçmeyen taslağı yalnız bir hekim imzalar, 3.19) | Sorumlu Hekim, Ünite Hekimi | `admissions.sign_off` |
| Taburcuyu başlat | Sorumlu Hekim, Ünite Hekimi | `admissions.move.initiate` |
| Nakil et (3.20) | Sorumlu Hekim, Ünite Hekimi; Hemşire, Sorumlu Hemşire | `admissions.move.initiate` ya da `admissions.transfer.confirm` |
| Hasta çıktı · onayla | Sorumlu Hemşire | `admissions.discharge.confirm` |
| Temizlik bitti · boş | Hemşire, Sorumlu Hemşire | `beds.release` |
| Yönetim › Yapı | Sistem Yöneticisi | `structure.manage` |

Sistem Yöneticisi bütün izinleri taşır, ama hekim adı geçmeyen bir taslağı imzalayamaz: imzalayan
sorumlu hekim olur ve sorumlu hekim bir hekim olmalıdır (3.19). Kabulü hekim yapmaz, imzalar (D6): hekim Kabul sekmesini
salt okunur bir notla görür. "Hekim" grubu kabul kayıtlarını görür ama imzalamaz ve taburcu
başlatmaz. Herkes yalnız kendi birimlerinin yataklarında işlem yapar (birim kapsamı); birimi
atanmamış hesap (pilot ayarı) ve yönetici her yere ulaşır.

**Hasta numarası:** Homunculus her kabule bir numara verir: `H` + yılın iki hanesi + beş hane
(ör. `H2600001`). Kurum ve takvim yılı başına sıralıdır (yıl UTC'dir), her yıl 1'den başlar; iki
kabul aynı numarayı asla alamaz; bir yılda 99 999'a ulaşılırsa kabul reddedilir. `H` öneki
numarayı HBYS protokol numaralarından ayırır — ikisi aynı olsaydı iki hasta tek karta düşerdi.
HBYS protokol numarası ayrı ve isteğe bağlı bir alandır. Aynı kişi yeniden yatarsa yeni bir numara
alır. (Grup 2 · B1d'den sonra yeni kabullerde başucu cihazına girilen, etikete basılan ve kartın
anahtarı olan numara Homunculus'un verdiği **protokol numarasıdır**, H-numarası değil; bkz. §3.10.)

**Numara neden başucu cihazına girilir:** monitör ölçümü hastanın numarasıyla gönderir; Homunculus
ölçümü bu numaraya bakarak karta bağlar. Kabulden sonra ekran numarayı büyük yazar ve "Başucu
cihazına bu numarayı girin" der. Numara cihaza girilmezse ya da yanlış girilirse ölçümler bu karta
ulaşmaz. (Aşama A'nın Infinity Kappa şeridi karta numarayla değil yatakla bağlanır: cihaz→yatak
tablosu yatağın kimliğini taşıdığında şerit o yataktaki kartta görünür — hastanenin sunucusunda
bunun için tablonun yeni sürümü gerekir.)

**Kart hemen, hekim imzası sonra:** "Kabul et"ten sonra kart hemen seçilen yatağa ve birime düşer
ve izlem başlar ("Panoda gör" onu gösterir). Kilo ve işaretlenen eşlik eden hastalıklar (KOAH,
kronik solunum yetmezliği, evde oksijen, demans / kronik konfüzyon) motora yazılır; motor hastayı
kendi bazaline göre değerlendirirken bunları kullanır. "Diğer eşlik eden hastalıklar" kaydedilir
ama motora kod olarak gitmez. Biri motora ulaşmazsa kabul yine durur ve ekran hangisinin
ulaşmadığını söyler. Hekim imzası sonraki adımdır (D3): imzalanmamış kabulde hasta ekranında
"Hekim imzası bekliyor — kart ve izlem imzayı beklemez" şeridi, yatak kartında küçük bir rozet
görünür. İmza yetkisi olan hekim şeritten "Kabulü imzala" der ve kabulün sorumlu hekimi olur.
İmzalanmamış kabul taburcu edilemez; Taburcu listesinde "Önce kabul imzalanmalı (hasta ekranı)"
yazar. Sunucunun yanıtı gelmezse ekran kabulün kaydedilip kaydedilmediğini bilmediğini söyler ve
yeniden göndermeden önce listeye bakmanızı ister; aynı form yeniden gönderilse de sunucu ikinci
bir hasta ya da numara açmaz.

**Taburcu iki adımdır** (D7):
1. **Hekim başlatır:** "Taburcuyu başlat" der ve çıkış şeklini seçer — Eve taburcu, Başka kuruma
   sevk (kurumun adıyla) ya da Vefat (exitus; bildiren hekim, boş bırakılırsa kendisi) — çıkış
   zamanı (gelecekte ya da kabulden önce olamaz) ve not. Hasta "Taburcusu başlatılan" listesine
   geçer, yatak "Taburcu bekliyor" olur.
2. **Sorumlu hemşire onaylar:** hasta servisten çıkınca "Hasta çıktı · onayla". Bu geri alınamaz:
   kart bütün ekranlardan kalkar, yatak temizliğe alınır.

**Kritik alarm tutması — başlatmada da, onayda da:** hastanın onaylanmamış kritik bir alarmı
varsa (kuralı susmuş ama kimsenin "Gördüm" demediği kritik alarm dahil, G2-A1) taburcu ne
başlatılabilir ne onaylanabilir. Düğme tutulur ve nedenini söyler; ekran görmese bile sunucu
kendisi reddeder. **Vefatta da istisna yoktur:** önce monitörün son kritik alarmları onaylanır,
sonra taburcu. Amaç, hasta servisten çıkmadan her kritik olayın birinin gözünden geçmiş olmasıdır
(kullanıcı kararı 26.10: onayda da denetle).

**Taburcudan sonra kart ve ölçümler:** kart her ekrandan kalkar — Yataklar, Alarmlar, hasta
ekranı; birimle sınırlı ekranlar da. Hastanın bilgileri silinmez, saklanır (kullanıcı kararı);
eski kabullere bakma ekranı sonraki dilimde gelecek. O numaraya sonradan gelen ölçümler motordan
önce düşer: alarm, çağrı ya da kart doğmaz, yalnız denetim kaydına bir satır yazılır (G2-A11).
**Bu yüzden taburcudan sonra numarayı başucu cihazından silin:** yeni hastanın ölçümleri eski
numarayla gelirse hiçbir ekranda görünmez ve alarm vermez. Yeni hastaya kendi yeni numarası girilir.

**Yatağın boşaltılması:** onaydan sonra yatak "Temizlikte"dir. Temizlik bitince hemşire ya da
sorumlu hemşire «Doluluk» ekranında "Temizlik bitti · boş" der (B3a'dan önce Hasta Kabul'ün Yataklar sekmesindeydi) — gece yönetici olmadan da yatak
dönebilsin diye (D8). Yatak, son hastasının kartı panodan kalkmadan boşalmaz: sunucu kartı bir kez
daha kaldırmayı dener, olmazsa "Bu yatağın son hastasının kartı hâlâ panoda; yatak boşaltılmadı"
der. Neden: eski kart dururken yatağa yeni hasta yatırılırsa aynı yatakta iki kart olur ve monitör
hangisine bağlanacağını bilemez. Taburcu onayında kart panodan kaldırılamadıysa «Nakil / Taburcu»
sekmesi "Panodan yeniden kaldır" düğmesini gösterir. Aynı kural, yataktan başka yatağa nakledilmiş
bir hastanın kartı için de geçerlidir (3.20).

**Yönetim › Yapı:** sistem yöneticisi koğuşu kurar: bina → birim (türüyle: Erişkin YBÜ, Yenidoğan
YBÜ…) → oda (numarası ve izolasyon isteğe bağlı) → yatak (etiketiyle). Adını değiştirir, kapatır,
yeniden açar. **Hiçbir şey silinmez;** kapatılan yer kalır ve kabule sunulmaz. Hastası olan yatak
kapatılamaz; altında açık yatak olan oda ya da birim de. **Bir birimde iki yatak aynı etiketi
taşıyamaz** — oda farklı olsa da, kapalı yataklar dahil; büyük/küçük harf ve baştaki/sondaki
boşluk fark etmez — böylece bir etiket birimde tek bir yeri gösterir. Aynı birimde iki oda da aynı
adı taşıyamaz. Her yapı değişikliği denetim kaydına yazılır. **Ekranlar yerleri hep adıyla
söyler, asla iç kodla:** yatak "etiket · oda · birim" diye yazılır (ör. "3 · Otaq 1 ·
Reanimasiya"). Ad henüz okunamadıysa yer tutucu bir numara ("Birim 1") ve bunun yalnız yer tutucu
olduğunu söyleyen bir not görünür; yapı okunmuş ama yeri tanımıyorsa ekran "Bilinmeyen birim 1"
der.

**Kapsam düzenleyicisi:** Yönetim › Kullanıcılar'da bir çalışanın birimleri düzenlenirken seçenekler
artık yapıdan gelir: her birim adıyla, her yatak "etiket · oda · birim" olarak, boş bir birim de.
Kod yazma kutusu yoktur ve aynı yer iki kez verilemez. Eski, serbest metinle verilmiş atamalar
yazıldığı gibi görünür ve kaldırılabilir; yalnız eski anahtarıyla bilinen boş bir birim ise buradan
verilemez (kapsam dilimine kaldı). Panodaki kapsam notu da atanmış ama kartı olmayan birim ve
yatakları okuyanın dilinde, adlarıyla söyler.

**Kişi başına tek açık kabul:** aynı ad soyad ve doğum tarihiyle açık bir kabul (imza bekleyen,
yatan ya da taburcusu başlatılmış) varken ikinci kabul reddedilir: "Bu hastanın açık bir kabulü
zaten var; önce taburcu edilmeli." Açık kabulün yatağı sizin birimlerinizdeyse numarası da yazılır.
Karşılaştırmada büyük/küçük harf, aksan ve fazla boşluk fark etmez (İ/ı dahil); "ə" ise
ayrışmaz: "Məmmədov" ile "Memmedov" iki ayrı addır. Neden: bir sayfa yenilemesi, ikinci bir sekme
ya da yeniden giriş aynı hastayı iki yatağa yatıramasın.

**Nakil:** B1a'da kapalıydı. Eski iki adımlı transfer yolu kartı eski yatakta bırakıyordu (aynı
yatakta iki kart, bozulan monitör bağlantısı), ve bir birimin hekimi başka bir birimin hastasını
kendi birimine taşıyabiliyordu. B1b onu tek adımlık nakil olarak, iki yatağın birim denetimi ve
ekranıyla yeniden açtı (bkz. 3.20). Sekmenin adı da bu yüzden «Nakil / Taburcu»dur.

**Reddedilen işlem:** sunucu her reddi değişmez bir kodla verir; ekran onu okuyanın dilinde
söyler, sunucunun İngilizce sözcüklerini göstermez. Ret, işlemin konusu olan yatakla birlikte
bildirimde (toast) görünür.

**Bu dilimin henüz yapmadıkları**
- Transfer (B1b), bakım ekibi (B1c), protokol ve hasta etiketi, barkod (B1d). *Nakil B1b'de geldi
  (3.20).*
- HBYS'den bekleyen hastalar paneli ve formun HBYS'den önceden dolması (ADT akışı gelince).
- Yeniden yatan bir kişiyi eski kaydıyla eşleştirme (her yatış yeni numara alır); kimliği
  bilinmeyen hastanın (doğum tarihsiz) kabulü; başucu cihazında hastanın adının görünmesi.
- Taburcu edilmiş bir hastanın eski kabullerine ve bilgilerine bakma (kimin bakabileceği,
  denetimli — sonraki dilim).
- «Nakil / Taburcu» sekmesinde birim süzgeci; panonun liste görünümünde "Hekim imzası bekliyor" rozeti
  (rozet yalnız kartta).
- İmza, imzalayan hekimi bakım ekibine eklemez (B1c). *B1c'de kapandı: imzalayan hekim sorumlu
  hekim olur ve ekip satırı yazılır (3.19).*
- Kabul, Taburcu, Yataklar ve Yapı'nın Azerbaycanca, Rusça ve İngilizce metinleri yerel bir
  okuyucunun okumasını bekliyor.
- **Hastanenin sunucusunda henüz yok.** Dağıtım kullanıcının sözüyle yapılacak; orada önce
  Yönetim › Yapı'da koğuş kurulur, sonra monitörlerin cihaz→yatak tablosu yeni yatak kimlikleriyle
  onaylanır.

### 3.9 «Monitörler» ekranı: monitör–yatak eşleme (Grup 2 · Lane B)

«Monitörler» (sol ray) Aşama A'dan beri cihaz ekranıdır: her monitörün şeridi, hasta bilgisi
olmadan (şeridin altındaki «Dalga formunu göster» düğmesi o monitörün canlı dalgasını açar: 3.11).
Bu dilimle ekranın üstüne **«Monitör–yatak eşleme»** bölümü eklendi ve ekran sorumlu
hemşireye de açıldı. Bölüm yalnız eşlemeyi değiştirir; klinik bir karar vermez, hiçbir değer
hesaplamaz. Örneklerdeki adresler v2 dosyasındaki biçimdedir, hasta adı uydurmadır.

**Ne?** Hangi başucu monitörünün hangi yatakta durduğu. Monitör şeridi ve Aşama B'nin gölge motoru
bir monitörün değerlerini yalnız bu eşlemeyle bir yatağa, oradan da o yatakta yatan hastanın kartına
bağlar. Eşleme eskiden onaylı bir dosyaydı (`device-beds.icu2.json`, sürüm 2); bu dilimle
veritabanında, hastane başına bir tablo olur (`device_beds`, göç 0014) ve değişiklik bu ekrandan
yapılır. Tablo dağıtımda dosyadan bir kez aktarılır; dosya tarihçe olarak kalır ve hastanenin
sunucusunda onu düzenlemek artık hiçbir monitörü taşımaz.

**Kim?** Bölümü `devices.map_beds` ya da `devices.manage` yetkisi olan görür; eşlemeyi yalnız
`devices.map_beds` taşıyan değiştirir:

| Kim | Ne yapar |
|---|---|
| Sistem Yöneticisi | Görür, bağlar, çözer (bütün izinleri taşır) |
| Sorumlu Hemşire | Görür; **yalnız kendi birimlerinin** yataklarında bağlar ve çözer |
| Biyomedikal Teknisyen | Listeyi görür, değiştiremez (`devices.manage`) |

Sorumlu hemşire başka bir birimdeki yatağa monitör bağlayamaz, oradaki bir monitörü taşıyamaz ya da
çözemez. Yetki yeni bir hastanede Sorumlu Hemşire grubunda varsayılan olarak gelir; bugünkü
hastanede onu, tabloyu dosyadan aktaran tek seferlik içe aktarma verir. Yönetici yetkiyi Yönetim ›
Roller ve yetkiler'de başka gruplara da verebilir ya da geri alabilir; içe aktarmanın yeniden
çalışması geri alınmış yetkiyi geri koymaz. İçe aktarmadan önce açılmış bir oturum yetkiyi oturum
yenilenince alır. Bölüm yalnız monitör şeridi bu hastane için çalışırken çalışır; değilse «Monitör
şeridi bu hastane için çalışmıyor; eşleme şu an değiştirilemez.» der.

**Liste.** Ağ toplayıcısının bildirdiği ve tablonun tuttuğu her monitör bir satırdır, adres
sırasıyla. Sütunlar: **Monitör** (IP ve port, ör. `10.10.203.37 · 2050`; altında soluk yazıyla
grubu), **Merkezi istasyon adı** (merkezi monitörün ona verdiği ad, ör. `BED08`; yoksa «—»; bu ad
elle yazılmaz), **Görünürlük**, **Yatak** («bed08 · Otaq 08 · Reanimasiya» — yatağın Yapı'daki
etiketi, odası, birimi) ve **İşlem**. Liste ekran açıkken 5 saniyede bir ve her değişiklikten hemen
sonra yeniden okunur. Listede hiçbir yerde hasta yoktur.

**Satırdaki sözler**
- «görünüyor» — ağ toplayıcısı monitörü bildiriyor.
- «görünmüyor · son görülme 13:42» — 15 saniyeden uzun süredir bildirmiyor (saat bu tarayıcının
  yerel saatidir).
  Bağlıysa bağlı kalır: **hiçbir şey kendiliğinden çözülmez.**
- «görünmüyor · son görülme bilinmiyor» — API yeniden başladığından beri hiç bildirilmedi (son
  görülme yalnız bellekte tutulur).
- «bağlı değil» — monitör hiçbir yatakta değil. Ağ toplayıcısının yeni bildirdiği bir monitör de
  böyle görünür; onu görmek tabloya hiçbir şey yazmaz. v2'de yatağı olmayan tek satır (merkezi
  istasyon adı `BED01`) da «bağlı değil» okunur.
- «başka birimde» — monitörün yatağı sizin birimlerinizden birinde değil; yatağın adı gösterilmez,
  satırda düğme yoktur.

**Yatağa bağlama.** Satırdaki **«Yatağa bağla»** (monitör bağlıysa **«Başka yatağa bağla»**):
1. **Yatak seçilir, asla yazılmaz.** Pencere («Yatak seçin — 10.10.203.37 (BED08)») Yapı'daki
   yataklarınızı birim, oda ve etiket sırasıyla tek bir listede verir; her yatak «etiket · oda ·
   birim» diye yazılır. Kapalı yataklar soluktur, seçilemez ve nedenini söyler: «birim kapalı», «oda
   kapalı» ya da «yatak kapalı». Yatakta başka bir monitör varsa «monitör: 10.10.203.24 (BED11)»,
   yatakta hasta varsa «dolu» yazar — bu yalnız bilgidir, kararı sunucu verir. Monitörün şu anki
   yatağı listede yoktur. Seçip **«Devam»**.
2. **Tek cümlelik onay** («Onaylayın»): «10.10.203.37 (BED08) → bed08 · Otaq 08 · Reanimasiya».
   Yatakta başka bir monitör varsa «10.10.203.24 (BED11) bu yataktan ayrılacak.» da yazılır: o
   monitör aynı işlemde çözülür, bir yatakta hiçbir an iki monitör olmaz. Monitör başka bir yataktan
   geliyorsa «Monitör şu yataktan ayrılacak: …» der. **«Onayla»**.
3. **Yatakta yatan hasta varsa ikinci onay** («Bu yatakta yatan hasta var»). Hedef yatakta ya da
   monitörün ayrıldığı yatakta yatan bir hasta varsa — burada açılmış bir kabul ya da panonun o
   yatağa koyduğu bir hasta, HBYS'den gelenler dahil — sunucu değişikliği yapmaz ve bu adımı açtırır.
   Her yatak için bir satır: «Yatakta: bed08 · Ahmet Y.» ve altında «Monitörün değerleri bu hastanın
   kartına akmaya başlayacak.» (gidilen yatak) ya da «Monitörün değerleri bu hastanın kartına akmayı
   bırakacak.» (ayrılan yatak). Hasta yalnız kısa adıyla görünür; numara, doğum tarihi, kimlik
   görünmez. Oturumun panosunda o hastanın kartı yoksa satır yalnız «bed08: Bu yatakta yatan bir
   hasta var.» der. İlk odak **«Vazgeç»**tedir: Enter onaylamaz, vazgeçer. Onay **«Evet, devam et»**.

**Son onaydan önce hiçbir şey değişmez.** «Onayla» ve «Evet, devam et» düğmeleri adımları
açıldıktan sonra 600 ms soluk durur ve bir çift tıklamanın ikinci tıklaması sayılmaz: hızlı bir çift
tıklama bir adımı, özellikle hasta onayını atlayamaz. İkinci onay, ilk onayda gösterilen eşlemeyi yeniden gönderir; arada başka
biri eşlemeyi değiştirdiyse sunucu reddeder ve gösterilmemiş bir monitör çözülmez. Sonuç ekranda ve
bildirimde söylenir («10.10.203.37 (BED08) bağlandı: bed08 · Otaq 08 · Reanimasiya»; zaten öyleyse
«Değişiklik yok: zaten böyle.») ve liste yenilenir.

**Kısa ad nasıl kurulur.** Adın ilk sözcüğü tam, sonraki her sözcüğün ilk harfi ve nokta (en çok
üç); sondaki baba adı eki («oğlu», «qızı», «kızı»; «oglu», «qizi», «оглы», «кызы») düşer: «Ahmet
Yılmaz» → «Ahmet Y.», «Məmmədov Əli Həsən oğlu» → «Məmmədov Ə. H.». Harf yazıldığı gibi alınır,
büyütülmez. Ad kabulde tek bir serbest metin kutusudur ve sözcük sırası yazanınkidir: kısa ad bir
**tanıma yardımıdır, kimlik doğrulaması değildir.** Yalnız bu adımda, yatağın etiketinin yanında
görünür; bildirimde, günlükte ya da sunucuya giden istekte yoktur.

**Bağlantıyı çözme.** **«Bağlantıyı çöz»** yalnız bağlı bir monitörde görünür. Tek onay:
«10.10.203.37 (BED08) ile bed08 · Otaq 08 · Reanimasiya arasındaki bağlantı çözülecek.» Yatakta yatan
hasta varsa aynı ikinci onay gelir, bu kez «… akmayı bırakacak.» der. Sonra monitör listede «bağlı
değil» okunur; listeden ve tablodan silinmez.

**Değişiklikten sonra şerit.** Şerit değişikliği en geç bir sonraki okumasında (≤ 5 sn) gösterir:
- Bağlanan monitör yeni yatağının kartında görünür. Yatağın adı artık **Yapı'daki etiketidir**:
  v2'den gelen satırlar merkezi istasyonun yazımını taşır («BED05»), ekrandan yapılan her bağlama ise
  yatağı Yapı'daki adıyla yazar («bed05»). Cihaz satırı «Tabloda: uygulamada elle eşleme · doğrulama
  2026-11-01 14:05» der (saat bu tarayıcının yerel saatidir).
- Çözülen ya da yerinden edilen monitör «Atanmamış cihaz · 10.10.203.37» olur; değerleri hiçbir
  hastaya ait gösterilmez.
- Aşama B açıksa (aşama `rules`) gölge motor bir sonraki monitör paketinde yeni bağlantıya geçer:
  değerler yeni yatağın hastasına akar; biten bağlantıda eski hastanın açık gölge bulguları kapanır.

**Ret mesajları** (sunucu her reddi bir kodla verir, ekran okuyanın dilinde söyler):
- «Bu arada değişti — liste yenilendi; yeniden bakın.» — siz bakarken başka biri eşlemeyi değiştirdi.
  Pencere kapanır, liste yeniden okunur; yeniden bakıp yeniden deneyin.
- «Bu yatak sizin birimlerinizden birinde değil.» — hedef yatak ya da monitörün ayrıldığı yatak
  sizin birimlerinizde değil; ret hangi yatak içinse onun adıyla gelir.
- «Bu yatak, odası ya da birimi kapalı.» — yatak siz seçerken kapatıldı.
- «Bu monitörü ağ toplayıcısı bildirmiyor.» — ne tabloda ne ağ toplayıcısının listesinde.
- «Monitör şeridi bu hastane için çalışmıyor; eşleme şu an değiştirilemez.»

Bu retlerde hiçbir şey değişmemiştir. Sunucudan hiç yanıt gelmezse değişiklik yapılmış olabilir:
pencere kapanır ve liste yeniden okunur — tekrar denemeden önce listeye bakın.

**Yönetim › Yapı ile ilişkisi.** Şerit monitörün yatağını eşleme satırındaki etiketle adlandırır,
liste ise Yapı'daki adıyla. Bugünkü tablonun v2'den gelen satırları «BED05» der; Yapı'daki yatak
«bed05» olabilir. Monitörü bağlı bir yatakta:
1. **Etiket değişmiyorsa** (yalnız kapatma ya da açma, ya da aynı etiket) eşleme satırına dokunulmaz.
2. **Yapı etiketi, satırın zaten taşıdığı etikete çevrilirse** (Yapı'da «bed05» → «BED05») yalnız
   yapı değişikliği kaydedilir: eşlemede yeni satır yoktur, tablonun sürümü ve özeti aynı kalır,
   şerit «BED05» okumaya devam eder. Bir yatağı v2 etiketine hizalamanın temiz yolu budur.
3. **Başka herhangi bir etikete çevrilirse** (ör. «Yatak 5»; büyük/küçük harf farkı da sayılır) eski
   satır kapanır, aynı monitör aynı yatakta yeni etiketle açılır (`device_bed.relabel`): tablonun
   sürümü bir artar, özeti değişir, şerit yeni etiketi gösterir.

**Monitörü bağlı bir yatak kapatılamaz.** Yapı «Bu yatağa bir monitör bağlı — önce «Cihazlar»
ekranında bağlantıyı çözün.» der (bildirim yatağın adıyla başlar): önce «Cihazlar»da bağlantıyı
çözün, sonra kapatın. Oda ve birim ancak bütün yatakları kapalıyken kapandığı için onlar da buna
bağlıdır. Aynı dilimde Yapı'da iki düzeltme (B1a dağıtımının dersleri): boş bir kutunun düğmesi (ör.
«Yatak ekle») neden tutulduğunu artık kutunun altında görünür biçimde söyler, basıldıktan sonra hata
renginde; oda ekleme kutularının görünür etiketleri vardır («Oda adı», «Oda numarası (isteğe bağlı,
örn. 05)») ve altlarında «Yatak, oda eklendikten sonra odanın altında «Yatak ekle» ile eklenir.»
ipucu.

**Kayıt.** Her değişiklik denetim kaydına eski ve yeni satırıyla, yapanın kullanıcı adıyla yazılır:
`device_bed.bind`, `device_bed.unbind` (yerinden edilen monitör için de, «replaced» nedeniyle),
`device_bed.relabel` (Yapı'daki ad değişikliği) ve ilk aktarım için `device_bed.import`. Hastası olan
yatakta onaylanmış bir değişiklik o hastanın pano numarasını taşır, adını asla. Tablo geçmişi silmez:
bir değişiklik eski satırı kapatır, yenisini açar; veritabanı satır silmeyi ve kapatmadan başka her
düzenlemeyi reddeder.

**Bu dilimin henüz yapmadıkları**
- Ekranda eşleme geçmişi (geçmiş tabloda ve denetim kaydında durur, ekranı yok); merkezi istasyon
  adını düzenlemek (kimlik elle yazılmaz); doğru yatağı kendiliğinden önermek; ağ toplayıcısının
  göremediği ağlardaki monitörler; mobil; bir cihazı kalıcı olarak silmek.
- Eşleme bölümünün Azerbaycanca, Rusça ve İngilizce metinleri yerel bir okuyucunun okumasını
  bekliyor.
- **Hastanenin sunucusunda henüz yok.** Dağıtım kullanıcının sözüyle yapılacak («main'e al», sonra
  «onay»); o güne dek sunucudaki eşleme v2 dosyasıdır.

### 3.10 Protokol numarası, etiket ve cihaz sorgusu (Grup 2 · B1d)

Hastanenin kendi numaralandırmasında bir kişinin ömür boyu tek **hasta numarası**, her gelişinin
(her yatışın) ise yeni bir **protokol numarası** vardır. Homunculus'ta bir kabul bir geliştir: her
yeni kabul bir protokol numarası alır ve o numara her şeydir — hemşirenin başucu cihazına girdiği,
etiketin barkodunda basılan ve kartta görünen numara aynıdır. Bu dilim kimin hangi numarayla
yattığını ve cihazın hangi adı göreceğini düzenler; klinik bir karar vermez, hiçbir klinik değer
hesaplamaz. Örneklerdeki numaralar uydurmadır.

- **Numara.** On iki rakam, hepsi sıra (`202600000001`, `202600000002` …); kontrol hanesi yok.
  En küçük başlangıç `000000000001`: `000000000000` deneme etiketinin numarasıdır, hiçbir kabule
  verilmez. Kontrol hanesi olmadığı için tek hane yanlış yazılırsa komşu hastanın geçerli numarası
  çıkabilir: cihaz bulunan her numarayı **adıyla** gösterir, ve hemşirenin tek güvencesi o addır.
  Kabul formundaki isteğe bağlı «HBYS protokol no» ayrı bir alandır; Homunculus'un verdiği protokol
  numarası değildir.
- **Başlangıç numarasını yönetici girer** (Yönetim › Protokol ve etiket). Girilene dek **hiçbir
  kabul yapılamaz** (409 `protocol_not_configured`): Homunculus'un kendi seçtiği bir aralık eski
  HBYS'nin protokolleriyle çakışabilirdi. Numara yalnız **ileri** alınır: verilen son numaradan
  büyük olmalı (`protocol_not_forward`).
- **H-numarası** (`H26…`, B1a) olduğu gibi verilmeye devam eder, ama etikete basılmaz ve yeni
  kabulün kartının anahtarı değildir. Bu dilimden önce açılmış kabuller H-numarasıyla kalır.
- **Etiket.** Varsayılan 50×30 mm, Zebra için; genişlik, yükseklik ve yazıcı çözünürlüğü (203 ya da
  300 dpi) aynı sekmede. Barkod **Code 128-C**: rakam çiftlerini kodlar, 12 hane 121 modül eder
  (sessiz alanlar dahil); bir modül 203 dpi'de 3, 300 dpi'de 4 yazıcı noktası. 203 dpi'de etiket en
  az 49 mm, 300 dpi'de en az 44 mm genişlikte olmalı. Satırlar: barkod, protokol (büyük), **tam
  ad** (kâğıtta ad hiç maskelenmez), doğum tarihi · cinsiyet, birim · yatak; boş satır «—» diye
  yazılmaz, düşer. Uzun bir ad kesilmez: yazı adın uzunluğuna göre küçülür, gerekirse üçüncü bir
  satıra iner; yer yetmezse önce «birim · yatak», sonra doğum satırı bütünüyle düşer, ad asla.
  Kabul kutusu «Etiketi yazdır»ı, hasta ekranı «Etiketi yeniden yazdır»ı gösterir; her basım
  denetim kaydına düşer (`admission.label_print`, adsız). «Deneme etiketi yazdır» yalnız sentetik
  `000000000000` ve «DENEME ETİKETİ» basar, sunucuya hiçbir şey sormaz. Zebra sürücüsünde etiket
  stoku bu boyutta, ölçek %100 olmalı.
- **Cihaz sorgusu.** Connex Spot'a numara girilince NCE köprüye `QBP^Q22` sorar; köprü önce API'ye
  sorar (`POST /edge/patient-query`, en çok 2 sn, yalnız cihaz jetonu, nginx dışarı açmaz):
  - **bulundu** → cevap adı her zaman, doğum tarihini ve cinsiyeti de taşır; cihazın bunları
    ekranda nasıl gösterdiği sahibin NCE oturumunda doğrulanacak (spec §12, O4);
  - **bulunamadı** (bilinmeyen ya da taburcu edilmiş numara) → `NF`: tasarım gereği cihaz numarayı
    doğrulayamaz, hemşire yatak başında düzeltir; cihazın `NF`'de ne gösterdiği ve kaydetmeye izin
    verip vermediği de aynı oturumda doğrulanacak (spec §12, O3). Yine de kaydederse ölçüm bugünkü gibi
    adsız «kimlik kaydı yok» kartına düşer;
  - **API cevap vermedi** → köprü kendi aynasından cevaplar; aynada da yoksa numarayı adsız geri
    yollar. Ölçüm kaybolmaz; «bilmiyoruz» ile «bulunamadı» ayrı kalır. API konteyneri durmuşsa
    (örneğin bir kurulum sırasında) da cevap en çok yaklaşık 2 sn sürer: 2 sn sınırı ad çözümünü ve
    yavaş gelen cevabı da kapsar (O9, kapandı). Aynı anda en çok 8 sorgu API'yi bekleyebilir; fazlası
    hemen aynadan cevaplanır. NCE'nin tanıdığı süre 10 sn'dir.
  API'nin kimlik deposunun Postgres süre sınırı vardır (kimlikte 2 sn; Lane A'nın pg-bounds
  dilimi), bu yüzden takılmış bir veritabanı birkaç saniye içinde 503 verir ve köprü hemen kendi
  aynasına döner (sunucu süreci tümden donmuşsa sınır yetmez; o durumda cihazı köprünün kendi 2 sn
  sınırı korur).
  Köprünün rapor satırı `sorgu`, `sorgu_NF` ve `sorgu_api_hata` sayar; hiçbir numara loglanmaz.
- **Erişim kayıtları** (O10). API'nin kendi erişim kaydı kapalıdır (`--no-access-log`). nginx'in
  erişim kaydı yolu numarasız yazar (`/patients/:key/trends`, `/admissions/:id/label`); sorgu
  dizgesini ve Referer'ı hiç yazmaz. Bunu, rota tablosunu dolaşan bir test korur: numara taşıyan yeni
  bir rota, nginx onu da gizleyene dek testten geçmez. Bu tek kaydın dışarıda bıraktığı **tek yol**
  dalga panelinin sorusudur (`/infinity-waves/…`, 3.11): açık her panel saniyede yaklaşık 1,33 kez
  sorar, açık bırakılmış tek bir panel günde ~115.000 satır yazardı. Bu yolda hasta numarası yoktur;
  monitörün ağ adresi (bir cihaz kimliği) vardır. Başka hiçbir yol dışarıda kalamaz; bunu da bir test
  korur. nginx'in **hata kaydı** kapsanmaz: bir istek
  için hata ya da uyarı yazdığında (API kapalı ya da yeniden başlıyor, zaman aşımı, 413, giriş sınırı)
  isteğin tamamını, sorgu dizgesiyle yazar. Bu yüzden `docker compose logs web`, hasta numarası
  taşıyabilen bir kayıt olarak okunur.
- **Nakil** (B1b, bkz. 3.20) protokolü değiştirmez: nakil aynı gelişin içindedir, numara nakledilen
  kayıttan yeni kabul kaydına taşınır; etiket, cihaza girilen numara ve kart değişmez (O8).
- **Geri dönüş** yalnız ilk protokollü kabulden önce temizdir: sonrasında açık kabullerin kartları
  protokolle anahtarlıdır ve eski API onları eşleştiremez — geri dönüş ileri bir düzeltme demektir.

### 3.11 Dalga paneli: monitörün canlı dalgası (cihaz ve hasta ekranı · «dalga» dilimi)

Başucu monitörü ağa yalnız sayıları değil, her 200 ms'lik pakette dalgaların örneklerini de
yayınlıyor. Bu dilim o örnekleri çözer ve şeridin altında, monitörün yaklaşık **2 saniye
gerisinden** gelen, sağdan sola kayan bir panelde çizer: EKG, basınç (ART ya da P1), pleth ve
solunum. Panel **doğrulanmamıştır ve yalnız görüntüdür**: dalgadan hiçbir sayı çıkarmaz, alarm
vermez, ses çıkarmaz, hiçbir şey saklamaz. **Birincil alarm başucu monitörüdür**; panel ona
bakmanın yerine geçmez. Paketin yapısı ve doğrulamanın düzeyi: `docs/INFINITY-DALGA-FORMU.md`.

**Nerede?**
- **Hasta ekranında**, şeridin hemen altında — yalnız şeridin bu hastaya **tek bir** monitörü
  bağladığı hastada. Bağ belirsizse ya da yoksa panel de yoktur: dalga bir hastaya ancak şeridin
  açık bağıyla gelir. İlk yanıt gelene dek ve dalga bu kurulumda kapalıyken panel hiç çizilmez:
  ekran dolduramayacağı bir kutu göstermez.
- **«Monitörler» ekranında** (3.9), her monitörün şeridinin altında **«Dalga formunu göster»**
  düğmesi. Panel kendiliğinden açılmaz — bir monitör listesi, kimse bakmadan hiçbir monitörün
  dalgasını istemez; **«Dalga formunu gizle»** kapatır. Burada elle açılan panel, gösteremediğinde
  nedenini söyler (aşağıda «Panelin notları»).
- Paneli şeridi gören görür: aynı yetki (`board.view` ya da `devices.manage`), aynı hastane, aynı
  kapsam. Göremediğiniz bir monitörün dalgası için sunucu, hiç olmayan bir monitörünkiyle aynı
  yanıtı verir.
- Panel yalnız açıkken ve sekme görünürken, 750 ms'de bir sorar; kapanınca o monitör için tuttuğu
  her şeyi unutur.

**Panelde her zaman yazanlar.** Başlık «‹yatak ya da cihaz› · Dalga formu · doğrulanmamış»,
yanında «DOĞRULANMAMIŞ» etiketi ve «≈ 2 sn gecikmeli». Altında, panelin herhangi bir parçası
ekrandayken — tam ekranda da — şu damga: **«Dalga · doğrulanmamış · yalnız görüntü — birincil
alarm başucu monitörüdür»**.

**Satırlar** (sabit sırayla; yalnız monitörün gönderdiği dalgalar için):
- **EKG** — en çok iki satır: monitörün o an canlı olan EKG kanalları. Her biri yalnız «EKG» diye
  yazılır, yanında «derivasyon adı doğrulanmadı»: hangi kanalın canlı olduğu yataktan yatağa
  değişiyor ve kanal→derivasyon eşlemesi doğrulanmadı, bu yüzden «II» gibi bir ad hiç yazılmaz.
  Kazanç sabittir (otomatik ölçekleme gürültüyü ritim gibi büyütürdü); satırı aşan tepeler
  kırpılır ve işaretlenir. EKG genliğinin mV karşılığı bilinmediği için mV ızgarası ve kalibrasyon
  çubuğu yoktur.
- **Basınç** — en çok iki satır, monitörün kendi adıyla: «ART» ya da «P1». mmHg cinsinden, sabit
  0–200 mmHg ekseni (aşılırsa 250), 50/100/150'de soluk çizgiler; yanında «ölçek ekranla
  doğrulandı».
- **Pleth** ve **RESP** — birim yok, «göreli»; ölçek son 10 saniyeye yavaşça uyar.
- Her satır kanıt sözünü yazar: «yapısal», «doğrulanmadı» ya da «ölçek ekranla doğrulandı». İzler
  düz mürekkeple çizilir (tam ekranda beyaz); monitörün renkleri kullanılmaz.

**Satırdaki sözler**
- «sinyal yok» — monitör o kanal için "sinyal yok" gönderiyor (derivasyon bağlı değil, kanal
  kapalı). O kanala **çizgi çizilmez**: düz bir EKG çizgisi asistoli gibi okunurdu. Monitörün
  gönderdiği ama hiçbir kanalı canlı olmayan bir grup da (örneğin derivasyonları çıkmış EKG) bir
  satır alır ve «sinyal yok» der — EKG'nin yokluğu boşluk olarak değil, söz olarak görünür.
- Eksik bir parça çizgiyi böler; boşluk hiçbir zaman doldurulmaz, tahmin edilmez.
- «akış durdu · N sn» — veri kesildi. Çizim verinin sonuna varınca iz donar; 1,5 saniye sonra
  soluklaşır ve bu söz çıkar (veri kesildikten yaklaşık 3,5 saniye sonra). N, verinin bitişinden
  beri geçen saniyedir.
- «akış durdu · N sn · iz kaldırıldı» — verinin bitişinden 10 saniye sonra iz silinir. Eski bir
  dalga hiçbir zaman güncel gibi gösterilmez.
- «dalga bekleniyor» — panel açık, çizilecek dalga henüz gelmedi.

**Panelin notları** (panel çizemediğinde nedenini söyler):
- «Dalga akışı yok» — sunucu dalgayı hub'dan şu an alamıyor (hub yanıt vermiyor, hub'da dalga yolu
  yok ya da ayarlar eksik). Ekrandaki izler kalır ve yukarıdaki gibi «akış durdu»ya yaşlanır; panel
  sormaya devam eder.
- «Dalga formu bu kurulumda kapalı» — `INFINITY_WAVES` açık değil ya da şerit bu hastane için
  kapalı. Bu not yalnız «Monitörler»de görünür; hasta ekranında panel hiç çizilmez.
- «Bu cihazın dalga formunu görme yetkiniz yok» ve «Bu cihazın dalga formu gösterilemiyor» — yetki
  ya da kapsam; izler hemen kaldırılır.

**Tam ekran.** Panelin ⤢ düğmesi («Tam ekran görünüm») aynı satırları siyah zeminde, uygulamanın
üst çubuğunun altından ekranın geri kalanını doldurarak açar. Damga tam boyda kalır; yanında bu
monitörün şerit sayıları, şeritteki adları, yaşları ve kanıt sözleriyle durur (hasta bilgisi
olmadan). **Tam ekran hiçbir alarm işaretini örtmez:** uygulamanın üst çubuğu — bekleyen alarm
sayısıyla alarm zili ve açılan listesi dahil — tam ekranın üstünde görünür ve kullanılabilir kalır
(tam ekrandaki hemşire başka bir yatağın yeni alarmını zilden görür). Tab tuşu üst çubuğun
düğmeleriyle tam ekranın × düğmesi arasında dolaşır, siyahın arkasındaki sayfaya gitmez. Esc (odak
tam ekrandayken), × («Dalga görünümünü kapat») ya da tarayıcının tam ekranından çıkmak kapatır;
odak ⤢'ye döner. (Üst çubuğun «Tam ekrandan çık» düğmesi ayrı bir düğmedir: tarayıcının tam
ekranından çıkar, bu da görünümü kapatır.) Odak üst çubuktayken Esc çubuğun kendi menüsünü kapatır, tam ekranı değil.
Uygulamanın bildirimleri, ekran kilidinden önceki geri sayım ve alarm sesini başlatan düğme tam
ekranın üstünde, görünür kalır ve kendi tuşlarını korur. Gösterilecek satır kalmazsa (bir ret geldiyse ya da dalga kapatıldıysa) tam ekran kendiliğinden
kapanır ve panel nedenini söyler; hasta ekranında dalga kapatıldıysa panel de kalkar.

**Yapmadıkları**
- **Ses yok.** Nabız sesi (bip), alarm sesi ya da başka hiçbir ses çıkmaz; prototipteki sesler
  geri gelmedi. Çözülen bir R dalgasından çıkan bip, dalgadan türetilmiş bir sayı olurdu ve ekranı
  sesli bir monitör taklidine çevirirdi.
- **Dalgadan sayı yok.** Dalgadan hiçbir nabız, solunum hızı, basınç değeri, ölçüm, kumpas, skor,
  alarm ya da bildirim üretilmez; ne gerçek motora ne gölge motora bir şey gider. Panelin yanındaki
  sayılar şeridin sayılarıdır.
- **Saklama yok.** Hub'da ve tarayıcıda en çok son 20 saniyelik dalga (monitörün kendi saatine
  göre son 20 saniye, duvar saatine göre değil), yalnız bellekte; sunucuda (API) da izlenen monitör
  başına son 20 saniyelik bir halka, hub'a 750 ms'de bir yalnız yeni bloklar sorularak doldurulur,
  kimsenin 20 saniyedir sormadığı monitörünki unutulur (dalga-perf). Bir monitör susunca son
  blokları biri sorana ya da hub yeniden başlayana dek hub belleğinde, panel kapanana
  dek tarayıcı belleğinde kalabilir — 10–20 saniyedir susan bir monitörün blokları sorulursa yine
  gönderilir ve tarayıcı onları yaşlarına göre «akış durdu» diye gösterir; hiçbir zaman
  güncel/canlı gibi gösterilmez ve hiçbir yere yazılmaz: veritabanına, denetim kaydına, günlüğe ya
  da dışa aktarıma gitmez. (Hub'ın şifreli paket günlüğü ham paketleri bugüne dek nasıl tutuyorsa
  öyle tutar; bu dilim ona okuyucu eklemez.) Panelin sorusu erişim kaydına da yazılmaz: sunucunun
  tek ve numarasız erişim kaydının dışarıda bıraktığı tek yol budur (3.10, «Erişim kayıtları»).
- Kayıt, yazdırma, dışa aktarma, geriye dönük izleme (full disclosure) ve EKG kalibrasyonu yok.

**Ne doğrulandı, ne doğrulanmadı.** Doğrulanan: paketin ve dalga bloklarının yapısı, zamanlaması
ve sürekliliği; paketten okunan sayıların ekrandakilerle saniye düzeyinde (yaklaşık 1 sn) aynı
anda değişmesi; iki basınç dalgasının ölçeği (örnek ÷ 40 = mmHg; P1'de ekrandaki sistolik ve
diyastolikle 2 mmHg içinde). Doğrulanmayan: dalganın ekranla **örnek düzeyinde** (atım atım)
hizası, EKG kazancı (mV karşılığı) ve EKG derivasyonlarının adları. Koğuşta ekranla örnek
düzeyindeki karşılaştırma geçene dek kanıt sözü «yapısal» kalır.

**Açma ve kapatma.** Panel varsayılan olarak **kapalıdır**: API `.env`'deki `INFINITY_WAVES=on`
ayrı ve açık bir dağıtım adımıdır. Ayrıca şeridin açık olması, araştırma penceresinin hub ayarları
(`INFINITY_HUB_URL` — https, `INFINITY_VIEWER_TOKEN`, `INFINITY_HUB_CA_FILE`) ve hub'ın dalga yolunu
taşıyan yeni sürümü gerekir. Bayrak açık ama hub ayarları eksikse panel «Dalga akışı yok» der ve
sunucu nedeni açılışta bir kez günlüğe yazar. Kapatmak için bayrak kaldırılır ve API yeniden
başlatılır: hasta ekranından panel kalkar, «Monitörler»de açılan panel «Dalga formu bu kurulumda
kapalı» der.

**Hub'da çözme kuyruğu (dalga-perf).** Hub gelen paketi önce onaylar; dalga bloklarını sonra, ayrı
bir iş parçacığında çözer (kuyrukta en çok 64 paket; kuyruk dolarsa en eskisi atılır ve sayılır).
Hub'ın durum sayfası (`/v1/status`, `waves`) bunu `dropped` (atılan) ve `queued` (bekleyen) olarak
gösterir. 3 saniyeden eski kalan paket atılmaz, çözülürken reddedilir: `refused` (reddedilen)
sayacının `queued` > 0 ile birlikte artması saat farkı değil, çözücünün geride kaldığı anlamına
gelir.

**Hastanenin sunucusunda 3 Kasım 2026'dan beri açık — sahibin kararıyla.** Panel ilk kez 2 Kasım
2026'da çıktı: hub R7 sürümü, API ile web ve açık `INFINITY_WAVES=on` bayrağı. Aynı gün geri
alındı: tek bir açık panel bile hastanenin 2 vCPU'lu sunucusunda hub'ın paket yolunu yavaşlattı
(500 ms'den geç gelen paket payı %27, çözücü 172 bloğu reddetti); şerit, yatak panosu ve alarmlar
etkilenmedi. Düzeltme yukarıda anlatılan iki değişikliktir — hub dalga bloklarını paketi
onayladıktan sonra, paket yolunun dışında ayrı bir iş parçacığında çözer; API hub'a 750 ms'de bir
yalnız yeni blokları sorar ve tarayıcıları kendi 20 saniyelik halkasından besler. Hub R8 sürümüyle
3 Kasım 2026'da ölçülü bir deneme olarak yeniden çıktı (sahibin «onay»ı; blokları ve kaydı
`DALGA2-bloklari.txt`'te). Ölçümler: panel kapalıyken hub'ın paket yolu R6 tabanından daha temiz
(500 ms üstü %1,02); tek bir açık panelle sunucu bir kez sınırın içinde (paket başına 48 ms, %2,1),
bir kez dışında (63,9 ms > 60 ms; %3,44 > %3) ölçüldü — iki ölçüm aynı yükte sunucunun diskiyle
ayrıştı (hub'ın kayıt commit süresi 23 → 43 ms, disk beklemesi %5,8): çözücü artık darboğaz
değil, her yoklamadaki dokuz yetki sorgusu (≈30 ms işlemci) ve hub'ın diske duyarlı kayıt yolu
öyle. Kural gereği bayrak kapatıldı; sahip paneli aynı gece yeniden açtırdı («dalgaları geri
getir, işlemci ekleyeceğim»). Panel yalnız görüntüdür: alarmlar, kartlar ve 3 saniye sınırı
etkilenmez; panel açıkken şeridin paket gecikme kuyruğu ≈%3–4 olur. Sunucuya işlemci ya da disk
eklendikten sonra ölçümler yeni bir tabanla yinelenir; sonraki adımlar (sunucuyu büyütmek, yetki
sorgularını birleştirmek, hub kaydının commit maliyeti) sahibin kararıdır — Lane A'nın kapasite
planında.

### 3.12 Yatak başı ölçüm ve «hatalı giriş» (Grup 3 · G3-01)

Hemşirenin yatak başında ölçtüğü vitaller artık elle girilir ve **gerçek motora** gider; eskiden
bunları HBYS akışı taşıyordu. NEWS2'yi motor hesaplar; puan alarm bandına çıkarsa alarm, cihazdan
gelen bir değerdekiyle aynı yolu izler: Alarmlar ekranı, hemşire bildirimi, onaylanmazsa hekime
yükseltme. Bu, serviste yeni bir davranıştır; hastane sunucusuna çıkmadan önce servise söylenir.
**Durum:** 2 Kasım 2026'dan beri hastane sunucusunda çalışıyor (göç yok). Örneklerdeki değerler
uydurmadır.

- **Ne girilir.** NEWS2'nin yedi parametresi: solunum sayısı, SpO₂, ek oksijen, sistolik tansiyon,
  nabız, bilinç (ACVPU), ateş. Bir de isteğe bağlı MAP. Diyastolik yok: MAP okunduğu gibi girilir
  (arter hattı ya da monitörün NBP ortalaması).
- **İki giriş, tek form.**
  - «Yatak başı ölçüm» sayfası (`/olcum`, `clinical.chart` yetkisi; tablet ve telefon için): hasta
    seçilir, soyad ad ve doğum yılıyla kimlik onaylanır (koğuşun yazdığı sırayla, sahibin kararı 10 Kasım
    2026; doğum tarihi kayıtlı değilse ekran bunu
    söyler ve yine sorar), form doldurulur. «Hayır, eşleşmiyor» seçimi iptal eder ve sorumlu
    hemşireye bildirmeyi söyler; hiçbir şey kaydedilmez.
  - Hasta ekranındaki «Ölçüm gir» (yalnız `clinical.chart` yetkisi olana görünür) aynı formu bir
    pencerede açar. Orada kimlik adımı yoktur, çünkü ekranın başlığı hastayı zaten söyler.
- **Boş kutu = ölçülmedi**, asla 0. En az bir değer yeter. Önizleme, formdakilere hastanın
  motordaki güncel kayıtlarını ekleyerek hesaplar: solunum, SpO₂, sistolik ve nabız için 1 saatten,
  ateş için 2 saatten eski bir değer puana girmez ve önizleme «Kısmi skor: … girilmedi ya da güncel
  değil» der. **Ek oksijen ve bilinç farklıdır:** girilmemişse (ya da 8 saatten eskiyse) skor onları
  «oda havası» ve «uyanık» sayar, bunu «varsayıldı» diye yazar ve skoru kısmi saymaz (bkz. 3.6).
  Oksijen alan ya da uyanık olmayan bir hastada bu iki kutuyu boş bırakmak puanı olduğundan düşük
  gösterir. Yedisini birden zorlamak hemşireyi eski değeri yeniden yazmaya iterdi, motor da onu taze
  sanırdı.
- **Önce önizleme.** «Önizle», motorun NEWS2'sini hastanın bir kopyası üzerinde hesaplar ve hiçbir
  şey yazmaz (`POST /clinical/{id}/preview`); kayıtla (`POST /clinical/{id}`) aynı kuralları uygular,
  yani kaydın reddedeceği değeri önizleme de reddeder. «Kaydet» yalnız tam olarak gönderilecek
  değerlerin önizlemesinde çıkar: bir kutu ya da saat değişirse önizleme eskir; kutular aynı kalsa
  da 5 dakikadan eski bir önizleme geçersizdir, «Kaydet» gider ve form «Önizleme 5 dakikadan eski;
  yeniden önizleyin.» der. Puanı motor hesaplar, karar hekimindir.
- **Sınırlar klinik eşik değildir**, yanlış basılmış bir haneyi ya da yanlış bir birimi yakalamak
  içindir (sunucu kayıt sırasında denetler; form aynısını yalnız hatayı kutunun altında göstermek
  için yansıtır):
  - solunum 0–80, SpO₂ 0–100, sistolik ve MAP 0–300, nabız 0–300; bu beşi **tam sayı** olmalıdır
    (88,5 atım bir ölçüm değil, yazım hatasıdır);
  - ateş 25–45 °C; formda en çok bir ondalık girilir («36,8» kabul edilir), sunucu yalnız aralığı
    denetler;
  - aynı formda MAP sistolikten küçük olmalı (eşit olamaz); ayrı zamanlarda girilen iki değer
    birbiriyle karşılaştırılmaz.

  Saat değiştirilmezse sunucunun saati yazılır. Değiştirilirse en çok 24 saat geriye gider, ileriye
  gitmez (sunucu yalnız iki dakikalık saat farkına göz yumar; form bir dakikaya, ve tarayıcının
  kendi saatiyle değil sunucuya göre düzeltilmiş saatle yargılar). Sunucu bu saat sınırını yalnız
  istek solunum, SpO₂, sistolik, MAP, nabız ya da ateşten birini taşıyorsa uygular; yalnız ek
  oksijen ya da bilinç girilirse sınırı form tutar.
- **«Hatalı giriş».** Bu formdan girilmiş bir değer geri alınır; düğme `clinical.chart` yetkisi
  olana görünür: satırdaki «Hatalı giriş» gerekçe penceresini açar, onay düğmesi «Hatalı giriş
  olarak işaretle»dir. İki yer vardır: «Kaydedildi» adımı (yalnız adım açıkken) ve vital eğrisinin
  tablosu (açık pencerede: 6 saat, 24 saat ya da 3 gün). Gerekçe 10–200 karakter olmalıdır (baştaki
  ve sondaki boşluklar sayılmaz; 200'ü aşarsa sunucu «gerekçe en çok 200 karakter olabilir» der)
  (`POST /clinical/{id}/entries/{entry}/retract`); pencere «Gerekçeye hasta adı ya da numarası
  yazmayın.» der, çünkü gerekçe denetim kaydında düz metin olarak kalıcıdır ve eğri her
  yenilemede onu taşır. Ek oksijen ve bilincin eğrisi yoktur: onlar yalnız «Kaydedildi»
  adımından geri alınır; adım kapandıktan sonra ekranda başka yolu yoktur. Yalnız yatak başı
  formunun sekiz değeri geri alınır. Başka bir kayıt — hekimin şüpheli enfeksiyon işareti, SOFA
  formunun laboratuvar değerleri, ilaç / sıvı / kilo kaydı (vazopressör, bolus) — için ekranda
  böyle bir yol yoktur ve sunucu da reddeder (409 «yalnız yatak başı ölçümü hatalı giriş olarak
  işaretlenebilir»); 3.6'daki «düzeltme yeni kayıttır» kuralı onlar için sürer. Değer silinmez:
  - denetim kaydına bir `chart_retract` satırı düşer;
  - hastanın motor durumu denetim kaydından, o değer **hiç girilmemiş gibi** yeniden kurulur
    (NEWS2, canlı SOFA, sepsis, antibiyotik saati, alarmlar); yeniden başlatmada da geri gelmez.
    İmzalanmış bir SOFA formu yeniden hesaplanmaz: o değerle imzalanmışsa imza olduğu gibi durur,
    gerekirse form yeniden imzalanır. Yanlış değerin tetiklediği bildirim ya da hekim çağrısı da
    geri çağrılmaz;
  - büyük grafikte üstü çizili kalır (kartın küçük grafiği yalnız motorun noktalarını çizer);
    tabloda gerekçesiyle, kimin ve ne zaman geri aldığıyla durur.
- **Alarmlara etkisi.**
  - Kayıt kapısı (`POST /clinical/{id}`) aciliyeti «anında» olan bir alarmı yeni açan HER kayıt
    için hemşireye bildirim yollar, yalnız elle girilmiş NEWS2 için değil: örneğin şüpheli
    enfeksiyon işaretinin ya da bir vazopressör kaydının septik şok alarmını açması.
  - Artık tetiklenmeyen alarm kapanır. Kimsenin onaylamadığı kritik bir alarm ise «geçti ·
    onaylanmadı» olarak panoda kalır (G2-A1) ve biri onaylayana dek durur; bu durum yeniden
    başlatmada korunmaz (plandaki O4).
  - Bir koruma: geri alma hastanın motorda hiçbir ölçümünü bırakmazsa «geçti · onaylanmadı»
    durumundaki alarmlar da kalkar; her biri için denetim kaydına, sebebi `entered_in_error` olan
    bir `alert_cleared` satırı yazılır (kartta o alarmın dayanacağı bir ölçüm kalmamıştır;
    yeniden başlatma da onu zaten geri getirmezdi). Ekrandan bugün oluşmaz: kritik bir alarm
    şüpheli enfeksiyon işareti ister ve o işaret geri alınamaz.
  - Yanlış değer daha eski bir ölçümü gölgeliyorsa, geri alma eskisini son ölçüm olarak geri
    getirir ve yeni bir alarm doğabilir; doğarsa hemşireye bildirilir.
  - Geri alma bir kişinin işidir: cihaz kimliği (köprünün jetonu) yapamaz, cihazdan gelen bir
    değer geri alınamaz, taburcu edilmiş bir numarada da yapılmaz.
- **«elle».** Elle girilen değeri «elle» diye işaretleyenler: trend kartı (son değer elle
  girilmişse); büyük grafiğin okuması (imlecin altındaki ölçüm elle girilmişse); tablo (elle
  girilen her satır, üstü çizili olan da). Hasta ekranının «Ölçülen değerler» kutusu ve «Yatak başı
  ölçüm» sayfasındaki hasta listesi işaretlemez: pano değerin kaynağını taşımaz. Listedeki «son
  ölçüm» hangi kaynaktan olursa olsun son NEWS2 girdisidir. Elle girilen değer gölge motora da
  gider (bkz. 5. bölümdeki «Gölge öneri» maddesi); hatalı giriş oradan da kalkar, ama gölge motor
  bunu sonraki dakikalık örnekte yargılar.
- **Geri dönüş**: eski imajlara dönülür, göç yoktur. Ama eski API `chart_retract`'ı bilmez:
  geri alınmış değerler eski sürümde yeniden sayılır; yeniden sayılan bir alarm hemşireye yeniden
  bildirilebilir. Geri dönüş bloğu (R-1) bu yüzden önce kaç geri alma olduğunu sayar; sayı 0 değilse
  sahibin aynı sayıyı yazdığı bir onay olmadan hiçbir şeye dokunmaz (`G3-BEDSIDE-bloklari.txt`).

### 3.13 «Denetim bütünlüğü» sayfası (Grup 2 · B4)

- **Ne:** `/denetim`. `audit.view` yetkisi olanlar görür: denetçi grubu, satıcı desteği (`platform_support`) ve hastane
  yöneticisi. Sayfa yalnız okur, hiçbir şey yazmaz. Menüde en sondadır; yalnız bu yetkiyi taşıyan biri girişte bu sayfaya
  düşer.
- **Zincir doğrulaması:** her denetim kaydı, kendinden önceki kaydın mührünü (hash) taşır. Arada bir kayıt silinir ya da
  değiştirilirse zincir o noktada kopar.
  - «Zinciri doğrula» mühürleri baştan yeniden hesaplar ve ilk kopan kaydı numarasıyla gösterir.
  - Doğrulama **yalnız düğmeyle** çalışır (sahip kararı). 2026-11-10'dan beri (sahip kararı, «Tamamını doğrula»)
    zincirin **tamamını** okur: en eskiden başlayarak 5 000'er kayıtlık sayfalarla, ilk kopukluğa kadar. Her sayfa
    API'nin ana döngüsünün dışında okunur ve hesaplanır; ekranlar beklemez. Milyon kayıt başına yaklaşık 4 saniye
    işlemci tutar.
  - Bir hastanede aynı anda **tek doğrulama** çalışır. Biri sürerken basılan düğme «doğrulama zaten sürüyor» der;
    ikinci bir doğrulama sıraya girmez.
  - Sonuç, doğrulamanın saatiyle görünür. Sayfadan çıkınca silinir: eski bir sonuç güncelmiş gibi gösterilmez.
  - Sonuçtaki kayıt sayısı, doğrulamanın baştan sona yürüdüğü kayıtlardır. Doğrulama sürerken yazılan bir kayıt
    bu sayıya girebilir de girmeyebilir de.
- **Son olaylar:** en yeni 200 olay, yeniden eskiye doğru sıralı.
  - Sütunlar: no, zaman, tür, kim, hasta, konu.
  - **Hasta kimliği maskelidir** (sahip kararı): yalnız son dört karakter görünür, örneğin `••••4821`.
  - **Kullanıcı kimliği de görünmez** (sahip kararı, 2026-11-11): kapsam ataması satırı bu sürümden beri değiştireni ve
    erişimi değişeni adıyla yazar; daha eski satırlarda kimlik `kullanıcı ••••1a2b` olarak maskelenir. Başka satırlardaki
    bir kimlik (örneğin görev satırlarında görevin kimliği, bir monitörün kimliği) «kullanıcı» demeden `••••a5b9` görünür.
  - Motorun yazdığı her olay türünün bir adı vardır ve süzgeçte yer alır. Bir test motorun kaynağını okur: sayfanın adını
    bilmediği bir tür yazılırsa ya da bir kaydın türünün nereden geldiğini okuyamazsa kırılır.
  - Olayın ayrıntısı (payload) ve mühürler gösterilmez.
  - «Tür» süzgeci seçilen türü sunucudan ister. Böylece seyrek bir tür, sayıca çok olan ölçüm kayıtlarının arasında
    kaybolmaz.
- **Kapsam:** birim kapsamlı bir hesap denetim kaydının tamamını göremez ve sayfa bunu söyler. Zincir doğrulaması ise hasta
  göstermediği için böyle bir hesaba da açıktır.
- **Alarm yoğunluğu (B6):** aynı sayfada üçüncü kutu, «Haritayı göster» düğmesiyle gelir.
  - Son 7 günde her hastanın hangi saatte kaç alarm olayı yaşadığını gösterir: satırlar hasta (maskeli), sütunlar
    günün saatleri (00–23, yerel saat), en sonda toplam.
  - Renk tonu yalnız tablodaki en yüksek sayıya göredir; klinik bir eşik değildir.
  - En çok alarmlı 30 hasta gösterilir. Satırlar yatak değil hastadır: denetim kaydı o anki yatağı tutmaz.
  - Kaynak: `docs/superpowers/specs/2026-11-09-g2b-b6-alarm-isi-haritasi-design.md`.
- Kaynak: `docs/superpowers/specs/2026-11-09-g2b-b4-denetim-design.md`; adlar ve türler:
  `docs/superpowers/specs/2026-11-11-g2b-b4-denetim-adlar-design.md`.

### 3.14 Doluluk: yatakların durumu, rezerv ve kullanım dışı (Grup 2 · B3a)

Servisin bütün yatakları tek ekranda, birime ve odaya göre: hangisi boş, hangisi dolu, hangisi
temizlikte, rezerve, kullanım dışı ya da bakımda — ve ne zamandan beri. Hasta Kabul'ün eski
«Yataklar» sekmesi buraya taşındı. **Durum:** 11 Kasım 2026'dan beri hastane
sunucusunda çalışıyor (göç 0016); yeşil/kırmızı yatak renkleri ve kimlik sorusundaki «soyad ad» sırası da
aynı gün sunucuya çıktı. Örneklerdeki adlar uydurmadır.

- **Kim görür.** Kabulleri okuyan, kabul yapan, taburcu onaylayan ya da yatak boşaltan herkes,
  yalnız kendi birimlerinde. Kullanıcı yöneticisi ya da monitör eşleyicisi görmez.
- **Renkler.** Boş yatak **yeşil**, dolu yatak **kırmızı**: durum etiketi ve kutunun sol kenarı
  (sahibin kararı, 10 Kasım 2026). Temizlikte, taburcu ya da nakil bekleyen yatak amber; rezerve
  yatağın kenarı mavi, kullanım dışı ve bakımdaki gri; kapalı yatak renksiz. Renk tek işaret
  değildir, etiket durumu sözle de söyler. Buradaki yeşil ve kırmızı yatağın durumudur, hastanın
  risk düzeyi değil (risk hapları ayrı kurallarla boyanır, bkz. risk hapı bölümü). Birim
  başlığındaki «boş» sayısı da yeşildir.
- **Birim başlığı.** Birimin adı ve türü (Erişkin YBÜ, Yenidoğan YBÜ gibi); altında «1 / 4 doludur»:
  dolu yatak / kullanılabilir yatak. Kullanılabilir = açık, kullanım dışı ve bakımda olmayan; rezerve
  yatak kullanılabilir sayılır (hastasını bekler). Yanında sıfır olmayan sayılar: boş, temizlikte,
  rezervde, kullanım dışı, bakımda.
- **Dolu yatakta yalnız kısa ad.** «Məmmədov Əli Rauf oğlu» → «Əli M.»: ikinci kelime tam, ilk
  kelimenin baş harfi, çünkü koğuşta ad soyadı önce yazılır (sahibin kararı, 9 Kasım 2026). Baştaki
  tire ya da ayrı karakter olarak gelen aksan işareti kısa adı bozmaz: «-Kaya Ayşe» → «Ayşe K.».
  Kabul formundaki kutunun adı da bu yüzden «Soyad ad» (eksik alan uyarısı da böyle der). Numara,
  doğum tarihi, tanı gösterilmez.
- **Adlar nereden gelir.** Yalnız kendi kurumunuzun, yatakta hâlâ AÇIK olan kabulünden; aynı yatakta
  birden çok açık kabul görünürse en yenisinden. Taburcusu tamamlanmış kabul ad vermez. Ad ve not ayrı
  bir okumadan gelir (`GET /tenant/occupancy`); yapıyı okuyan ekranlar (Yapı, kapsam, monitör eşleme)
  hasta adı almaz ve yatağın notunu hiç açmaz, okunamayan bir not onları düşüremez.
- **Rezerv.** Sorumlu hemşire boş bir yatağı beklenen hasta için ayırır; isteğe bağlı not («kimin
  için, neden», en çok 200 karakter). Not hasta adı taşıyabileceği için **şifreli** saklanır; denetim
  kaydına yalnız «not yazıldı mı» düşer, metni düşmez. Rezerve yatağa kabul yasak değildir: kabul
  formu yatağın rezerve olduğunu ve notunu gösterip hemşireye sorar, «Yenə də bu çarpayıya qəbul et»
  denirse kabul eder. Bu «evet» tek yatak ve tek form içindir: başka bir yatakta ya da «Yeni qəbul»
  sonrası yeni hastada yine sorulur. «Evet» düğmesi, not okunana (ya da okunamadığı söylenene) dek
  bekler; hemşire notu görmeden karar vermez.
- **Kullanım dışı.** Boş bir yatak her zaman bir **nedenle** kullanım dışı bırakılır: arıza, izolasyon
  temizliği, personel yetersizliği ya da diğer («diğer» için not zorunlu). «Kullanıma aç» yatağı yeniden
  boş yapar; bakımdaki yatak için de aynı düğme çıkar. Yatakta açık bir yatış varsa ya da son
  hastanın kartı panodan inmemişse açılmaz (yatak boşaltmanın kuralları). Yönetici API'sinin ham yatak
  geçişi rezerve ve kullanım dışı durumlarına ne girer ne onlardan çıkar (400): ikisinin de notu ya da
  nedeni vardır, yalnız kendi denetimli yollarıyla (rezervi kaldır, kullanıma aç, onaylı kabul) değişir.
- **Bir anda bir işlem.** Bir düğmeye basıldığında diğer yatakların düğmeleri işlem bitene dek
  bekler; her işlemden sonra ekran yatakları ve adları yeniden okur. Adlar okunamazsa ekran bunu
  söyler ve yatakları adsız gösterir; eski bir adı yanlış yatakta göstermektense hiç göstermez.
  Her işlemin sonucu (yapıldı ya da reddedildi) bildirimin yanında başlığın altında da bir satır
  olarak durur, sonraki işleme kadar; bildirimi kaçıran da ne olduğunu bulur. İşlemden sonra düğmesi
  kalkan yatakta odak sayfanın başına düşmez, o yatağın kutusuna gider.
- **«Bu çarpayıya xəstə qəbul et».** Yatağı oturumun kabul formuna koyar ve Hasta Kabul'ü açar.
  Önceki kabul bittiyse yatak yeni bir forma girer, eski hastanın numarası ve bilgisi taşınmaz.
  Formda gönderim yolda, bekletilmiş ya da yanıtsızsa forma dokunmaz ve bunu söyler.
- **Yetki.** Rezerv ve kullanım dışı için yeni yetki `beds.manage_state` (sorumlu hemşire ve yönetici).
  Temizlik bitti için eskisi gibi `beds.release`.
- **Göç `0016`.** Yatak durumlarına «rezerve» eklenir; iki sütun gelir (neden, şifreli not). Geri
  alınırsa rezerve yataklar boşa döner ve durum zamanı yeniden damgalanır, böylece «ne zamandan beri
  boş» rezervin yaşını saymaz (Postgres bir durum değerini silemez, değer tipte kalır ama hiçbir yatak
  taşımaz).

### 3.15 RRT ekranı ve «RRT çağır» (Grup 2 · B5)

- **İki eskalasyon sistemi:**
  - **Canlı sistem.** Bellekte çalışır ve tek kademelidir: acil (`immediate`) bir alarm 5 dk cevapsız kalırsa «eskale» olur
    ve hekime bir kez bildirim gider.
  - **Postgres'teki üç kademeli sistem** (sorumlu hemşire → hekim → RRT) koddadır ama hiç çağrılmaz; VM'de tabloları hiç
    yazılmadı.
  - B5 canlı sistemin üzerine kuruldu; çalışmayan sisteme dokunulmadı.
- **Sahip kararı:** RRT yalnız elle çağrılınca gelir; otomatik RRT kademesi kapalıdır ve RRT ekranı bunu açıkça yazar. Alarm
  erteleme ayrı bir dilimdir (§3.21).
- **«RRT çağır» (Alarmlar ekranı):**
  - **Kim çağırabilir:** `alerts.escalate` yetkisi olanlar, yani RRT, sorumlu hemşire, hekimler ve yönetici. Hemşire
    çağıramaz; cihaz jetonu reddedilir, çünkü çağrıyı bir kişi yapar.
  - **Gerekçe zorunludur** (3–500 karakter). Gerekçeye ad ya da kimlik numarası yazılmaz.
  - **Kayıt:** çağrı denetim kaydına `rrt_call` olarak, çağıranın adıyla yazılır. Kayıt belleğe yazılmadan önce düşülür.
  - **Yanıtlanmış alarm:** böyle bir alarm için çağrı açılmaz.
  - **İkinci çağrı:** aynı alarm ikinci kez çağrılırsa hiçbir şey yazılmaz, ilk çağrı geçerli kalır.
- **RRT ekranı (`/rrt`):**
  - **İki liste:** «RRT çağrıları» (açık çağrılar) ve «Yoldaki cevapsız acil alarmlar» (çağrısız, cevap bekleyen acil
    alarmlar; hekime eskale olmuşsa bu yazılır).
  - **Menü rozeti** açık çağrı sayısını gösterir.
  - **Pano canlı değilse** ekran hiçbir zaman «çağrı yok» demez.
- **Çağrı ne zaman biter:** alarm «Gördüm» ile yanıtlanınca (yanıtlayan RRT üyesi de olabilir, hemşire de) ya da alarmın
  bölümü kapanınca.
- **Alarm gidip gelirse:** gecikme süresi içinde geri gelen bir alarmda çağrı, eskalasyon zinciriyle birlikte sürer.
- **API yeniden başlarsa:** açık çağrı denetim kaydından geri gelir. Yeniden başlatma, gidip gelen bir alarmın zincirini
  taşımaz; bu, mevcut zincir sınırlamasıdır.
- **Bu dilimde olmayanlar:** RRT cihazlarına anlık bildirim (push) yok; RRT çağrıyı rozetten ve ekrandan görür.
- **Kaynak:** `docs/superpowers/specs/2026-11-09-g2b-b5-rrt-design.md`.

### 3.16 Görevlerim: nöbetin iş kuyruğu (Grup 3 · G3-02)

«Görevlerim» ekranı (`/gorevler`, `tasks.view` yetkisi) bu nöbetin işlerini tek yerde gösterir. İki kaynak var:
bir hemşirenin ya da hekimin elle açtığı görev, ve **bir sonraki vital ölçüm**. **Durum:** 11 Kasım 2026'dan beri hastane
sunucusunda çalışıyor (göç 0017). Örneklerdeki değerler uydurmadır.

- **Vital ölçüm görevi hesaplanır, kaydedilmez.** Dayanak, hastanın son **elle girilen** NEWS2 değeridir (3.12'deki
  form; geri alınan giriş sayılmaz). Monitörden ya da HBYS'den gelen değer dayanak değildir. Son 48 saatte elle
  giriş yoksa dayanak kabul zamanıdır; o da yoksa ekran «ölçüm kaydı yok» der. Vade = dayanak + hastanın NEWS2
  bandının aralığı. Ölçüm kaydedilince görev kendiliğinden ilerler.
- **Aralığı hastane belirler, sistem değil.** Yönetim › Görevler sekmesinde (`structure.manage`) beş bant var:
  NEWS2 0, 1–4, tek parametrede 3, 5–6, ≥ 7. Yalnız «0 → 720 dk» varsayılan doludur; kaynağı kasadaki NEWS2
  belgesidir (RCP 2017: en az 12 saatte bir gözlem). Diğer bantlar boş gelir; hastane kendi protokolünü girer.
  **Boş bant görev üretmez** — bu, «ölçüm gerekmiyor» demek değildir, «bu bant için aralık girilmedi» demektir.
- **Durumlar.** planlı (vadesi gelmedi) · şimdi (vadesi geldi, gecikme payı içinde; pay varsayılan 30 dk) · gecikti ·
  tamamlandı · uygulanmadı. Gecikmiş bir ölçüm «uygulanmadı» diye bir aralık için atlanabilir; bunun için neden
  yazmak gerekir, ama metin saklanmaz — denetim kaydında yalnız «atlandı, kim, ne zamana kadar» olayı kalır.
- **Elle görev.** «Görev ekle»: hasta, metin (en çok 200 karakter; hasta adı yazmayın, yatak yeter), vade (en çok
  24 saat geri, 7 gün ileri), kime (hemşire / hekim / herkes). Üstlen · tamamla · uygulanmadı; her biri kimin
  yaptığıyla denetim kaydına yazılır, metin yazılmaz (metin veritabanında şifrelidir).
- **Görünüm.** Geniş ekranda nöbet başından (08:00 ya da 20:00) 24 saatlik ızgara, «şimdi» sütunu ve «Şimdiye git»;
  tablette liste (gecikenler önce, tamamlananlar gizli). Üstte sayaçlar; süzgeçler: tür, yalnız gecikenler, yalnız
  benim rolüm. Ekran 30 saniyede bir yenilenir; bildirim göndermez.
- **Ne yapmaz.** Hastanın ne sıklıkla ölçüleceğine karar vermez, ilaç / bakım planı / devir işlerini henüz
  göstermez (sonraki dilimler), kişiye atama yapmaz (bakım ekibi B1c'den sonra).

### 3.17 Sıvı dengesi: giriş/çıkış defteri (Grup 3 · G3-03)

Hasta ekranında İlaç kutusunun altındaki **«Sıvı»** kutusu, kağıttaki sıvı çizelgesinin yerini alır. **Durum:** 11 Kasım
2026'dan beri hastane sunucusunda çalışıyor (göç yok). Örneklerdeki değerler uydurmadır.

- **Ne girilir.** Aldığı: IV sıvı/infüzyon, kristaloid bolus, enteral/oral, kan ürünü, diğer. Çıkardığı: idrar,
  dren, diğer (NG, kusma). Her giriş mL ve saatle; saat en çok 24 saat geri, ileri olamaz. «Giriş/çıkış ekle»
  penceresinde birkaç satır birden girilir; yazma `clinical.chart` yetkisi ister.
- **Bolus iki yerden girilebilir:** İlaç kutusunun formu ve Sıvı penceresi. İkisi aynı kayıttır, iki kez sayılmaz;
  septik şok kuralı bolusu eskisi gibi okur.
- **Toplamları sunucu hesaplar:** bugün (sıvı günü 08:00'de başlar — Görevlerim'in nöbet ayarı), iki nöbet ara
  toplamı, son tamamlanan 24 saat, saatlik çubuk grafiği ve kümülatif denge. Tarayıcı toplama yapmaz.
- **İdrar ve SOFA.** Son tamamlanan 24 saatin idrar toplamının yanında Sepsis-3'ün SOFA böbrek satırı yazar:
  <500 mL/gün 3 puan, <200 mL/gün 4 puan. Sistem puan **vermez**, renk de kullanmaz; ekran o 24 saatin kaçında idrar
  kaydı olduğunu söyler, çünkü eksik kayıt toplamı düşük gösterir. mL/kg/sa (son 6 saat) yalnız sayıdır: kasada
  oligüri eşiği için kaynak yok.
- **Hatalı giriş.** Yanlış bir hacim (bolus dahil) gerekçeyle geri alınır; toplamdan çıkar, listede üstü çizili kalır.
  Bolus geri alınınca motor hastayı yeniden değerlendirir (septik şok kuralı dahil).
- **Ne yapmaz.** Pompadan otomatik veri almaz, saatlik idrar hatırlatması yapmaz (Görevlerim'e sonra eklenebilir),
  SOFA formuna idrar aktarmaz.

### 3.18 Vardiya devri (Grup 2 · B3b)

- **Ne:** `/devir`, «Vardiya devri». Devir yetkisi (`handover.sign`) olanlar görür: hemşire, sorumlu hemşire, hekim, yönetici.
- **Hasta başına devir** (sahip kararı): her hasta için ayrı bir devir yapılır. Devrin notu D-Ö-D-Ö düzenindedir:
  Durum · Öykü · Değerlendirme · Öneri. Taslak tanı içermez; nota ad ya da kimlik numarası yazılmaz.
- **İki imza:**
  - Giden kişi devri açar ve imzalar; teslim alan kişi karşı imzalar.
  - Teslim alan kişiyi giden kişi seçer (sahip kararı). Seçilebilecekler, devir yetkisi olan başka meslektaşlardır.
  - Yalnız seçilen kişi karşı imzalayabilir. Sunucu kişinin kendine ya da yetkisiz birine devretmesini reddeder.
- **Kritik alarm kilidi:**
  - Hastada yanıtlanmamış kritik alarm (çalan ya da kilitli kalan) varsa giden imza atılamaz.
  - Kontrol canlı panodan okunur; eskiden VM'de hiç yazılmayan bir tablodan okunuyordu.
  - Ekran da imzadan önce panoya bakar, ama son söz sunucunundur.
  - Pano canlı değilse ekran bunu söyler: «kritik alarm denetimini sunucu yapar».
- **Sistem özeti:**
  - Giden imza anında sistem panodan bir özet mühürler: risk, NEWS2, son vitaller, vazopresör ve açık alarmlar.
  - Özette ad yoktur. Teslim alan kişi notu ve özeti görür; güncel veri için hastayı açar.
- **Listeler:**
  - Üç liste var: «Karşı imzanızı bekleyenler», «Benim devrettiklerim» ve «Son 24 saat».
  - Liste kendiliğinden yenilenmez; «Yenile» düğmesi ve son okuma saati vardır.
  - Açık bir devrin 30 dakikalık süresi dolarsa devir «Süresi doldu» olur; yeni devir açılır.
- **Devrin birimi** (G4-02 incelemesiyle): sunucu devri hastanın yatağının birimine yazar (yatak → oda → birim);
  ekranın gönderdiği birim yalnız aynı hastaneye ait mi diye denetlenir, kayda geçmez. Yönetici özetinin
  «Karşı imzası bekleyen devir» sütunu bu birimle sayar (§3.24). Bir devirdeki hastalar farklı birimlerde yatıyorsa
  sunucu devri açmaz: her birimin hastaları ayrı devredilir (ekran zaten hasta başına tek devir açar). Bu
  değişiklikten önce açılmış devirler açıldıkları birimde kalır.
- **Denetim kaydı:** açma, imza ve karşı imza denetim kaydına yazılır. Notun metni kayda yazılmaz.
- **Bu dilimde olmayanlar:** menü rozeti, hasta ekranında «Teslim notu» sekmesi, sunucuda saklanan taslak, vardiya çizelgesi.
- **Kaynak:** `docs/superpowers/specs/2026-11-10-g2b-b3b-devir-design.md`.

### 3.19 Bakım ekibi: sorumlu hekim, yardımcı ve nöbetçi hekimler (Grup 2 · B1c)

Bir hastadan hangi hekimlerin sorumlu olduğu artık kayıtlı, görünür ve doğru tutuluyor. **Durum:**
11 Kasım 2026'dan beri hastane sunucusunda çalışıyor (göç 0018). Örneklerdeki
adlar uydurmadır.

- **Yalnız hekimler.** Ekipte üç rol var: **sorumlu hekim** (her an tek kişi), **yardımcı hekim** ve
  **nöbetçi hekim** (başlangıcı ve bitişi olan, en çok 48 saatlik bir pencereyle). Hemşireler ekipte
  değildir; hemşirenin yatakla bağı ayrı bir kayıttır. Kimin hekim olduğunu kişinin rol grubu söyler:
  Sorumlu Hekim, Ünite Hekimi ya da Hekim (hesap etkin ve kurumun üyesi olmalı). Hekim olmayan biri
  ekibe eklenemez, sorumlu hekim yapılamaz, «Sorumlu hekim ol» diyemez: sunucu 409 `care_team_not_physician`
  verir, ekran bunu okuyanın dilinde söyler.
- **İmzalayan sorumlu hekim olur.** Kabulü imzalayan hekim, formda başka bir sorumlu hekim adı yoksa,
  aynı işlemde sorumlu hekim olur ve ekipteki satırı yazılır; biri başarısız olursa ikisi de yazılmaz.
  Formda bir hekim adı varsa sorumlu hekim odur; formda hekim olmayan biri adlandırılırsa kabul açılırken
  reddedilir (422 `field_invalid:attending_physician_id`; Kabul ekranı hekim adı göndermez). Sorumlu hekim
  (formdaki, yoksa imzalayan) hekim değilse imza reddedilir: bir yönetici hesabı, hekim adı geçmeyen bir taslağı artık imzalayamaz; ekran «hekim
  değil» der. Kabul bu yüzden hekim hesabıyla imzalanır. (3.8'deki «İmza, imzalayan hekimi bakım ekibine
  eklemez» sınırı bununla kapandı.)
- **Kutu.** Hasta ekranında «Bakım ekibi»: her üyenin adı, rolü, nöbetçinin penceresi (geçtiyse
  «süresi doldu») ve onu kimin eklediği. Eski üyeler «Önceki üyeler» altında katlıdır, ne zaman
  çıktıklarıyla. Kimlik numarası gösterilmez. Kabul henüz imzalanmadıysa kutu yalnız «Sorumlu hekim,
  kabul imzalanınca atanır.» der. Hasta ekranı açık kabulleri bir kez okur (dakikada bir yeniler) ve imza
  şeridi, etiket ve kutu aynı okumayı kullanır; imza atılır atılmaz kutu ekibi gösterir. Kabuller hiç
  okunamadıysa kutu bunu tek satırla söyler.
- **Düğmeler.**
  - «Sorumlu hekim ol»: `care_team.claim` sahibi bir hekim, sorumlu hekim değilse.
  - «Ekibe ekle»: `care_team.assign` sahibi. Seçici kurumdaki bütün hekimleri adla sunar (kimlik numarası
    yok); başka birimden bir nöbetçi meslektaş da çıkar. Ekipte etkin satırı olan hekim sunulmaz; süresi
    dolmuş bir nöbetçi yeniden sunulur. Nöbetçi için başlangıç ve bitiş gerekir: bitiş başlangıçtan
    sonra, gelecekte ve en çok 48 saat sonra olmalıdır; başka rolün penceresi olmaz. Sunucu bunları
    ayrıca denetler (422).
  - «Sorumlu hekim yap» ve «Ekipten çıkar»: `care_team.assign` sahibi, sorumlu hekimin satırı dışında.
  - «Ekipten ayrıl»: üyenin kendisi, kendi satırında; sunucu için yalnız `admissions.view` yeter. Ama
    kutu, hasta ekranının birim kapsamlı kabul okumasına bağlıdır: kendi birimlerinin dışındaki bir nöbetçi
    hekimin kutusu yoktur, bu düğmeyi göremez. Satırını ekibi yöneten biri «Ekipten çıkar» ile bitirir
    (üyeyi tanıyan bir okuma sonraki dilimdir).

  Varsayılan gruplarda `care_team.claim` ve `care_team.assign` yalnız Sorumlu Hekim grubundadır (ve bütün
  izinleri taşıyan Sistem Yöneticisi grubunda); Ünite Hekimi ile Hekim ekibi değiştirmez. Ekip imzadan
  taburcuya kadar yazılır: taslak ya da kapanmış bir kabulde ekibe yazılmaz (409).
- **Sorumlu hekimin satırı.** Yeni bir sorumlu hekim atanırken ekran bir kez sorar: «X sorumlu hekim
  olur; Y ekipten çıkar.» (önceki yoksa yalnız «X sorumlu hekim olur.»). Soru «Sorumlu hekim ol»da,
  «Sorumlu hekim yap»ta ve «Ekibe ekle»de rol sorumlu hekimse sorulur; düğme cevaptır. Yeni sorumlu hekim
  öncekinin satırını bitirir; terfi eden yardımcının kendi eski satırı da kapanır, yani bir hekimin kabulde
  tek satırı kalır. Sorumlu hekimin satırı tek başına kaldırılamaz (409 `care_team_attending_required`;
  ekran «yeni bir sorumlu hekim atayın» der): yeni sorumlu hekim atanınca ya da taburcuda biter. Taburcu
  ekibin tamamını kapatır, kapanmış satırlar geçmişte kalır. İki hekim aynı anda «Sorumlu hekim ol» derse
  ikisi de geçer, sırayla; sonuncu sorumlu hekim kalır. Bir hekimin kendi ikinci basışı ve ekipte zaten
  olan birinin eklenmesi 409 `care_team_conflict` verir. Süresi dolmuş bir nöbetçi yeniden eklenebilir:
  eski satırı kapanır, yenisi yazılır. Nakilde ekip yeni kabul kaydına taşınır (B1b, bkz. 3.20).
- **Kendi hastası.** Ekipteki hekim hastasını panoda kendi birimlerinin dışında da görür; nöbetçi
  yalnız penceresi içinde. Ekipten çıkan artık görmez. Açık bir pano bağlantısı yeni üyeyi yeniden
  bağlanınca alır; diğer okumalar hemen. Ekip okuması, üyenin kendi satırı etkin olduğu sürece ona açıktır.
  Birimi dışındaki bir üye hastayı panoda görür, ama o hastanın ekranında kutu çıkmaz (sonraki dilim).
- **Sorumlu hemşire.** Sorumlu hemşire grubu `care_team.claim` yetkisini kaybetti: ekip hekimlerindir,
  hemşirenin bu düğmesi her zaman reddedilirdi. Grubun açıklamasından da «bakım ekibi» çıktı. Göçten
  önce giriş yapmış bir sorumlu hemşire, jetonu yenilenene dek yetkiyi jetonunda taşır; kutu ona düğme
  sunmaz, isteği yine reddedilir.
- **Denetim.** Her değişiklik denetim kaydına yazılır: kim, kimi, hangi yolla (imza, üstlenme, ekleme),
  hangi rolle ve hangi satırı bitirerek; hastanın adı yazılmaz. «Denetim bütünlüğü» sayfası (3.13) bu üç
  olayı adıyla gösterir ve «Tür» süzgecinde sunar: «Sorumlu hekim atandı», «Bakım ekibine eklendi»,
  «Bakım ekibinden çıkış».
- **Göç `0018`** (G3-02'nin `0017`'sinin ardından). Eski kısıt, bir üyenin aynı kabulden ikinci kez
  çıkarılmasını engelliyordu. Yerine iki kısmi tekil dizin gelir: kabul başına üye için bir etkin satır,
  kabul başına bir sorumlu hekim. Göç önce var olan satırları düzeltir:
  - kapanmış kabullerin (taburcu, nakil) açık satırlarını kapatır;
  - bir kabulde iki etkin sorumlu hekim satırı varsa en yenisini bırakır, ötekini kapatır;
  - imzalı açık kabulün etkin sorumlu hekim satırı yoksa adı geçen sorumlu hekim için yazar (hekimin o
    kabulde başka bir etkin satırı varsa o satır sorumlu hekim satırına dönüşür);
  - sorumlu hemşire grubundan `care_team.claim`'i alır ve grubun açıklaması varsayılan metinse
    «bakım ekibi»ni çıkarır; hastanenin kendi yazdığı açıklamaya dokunmaz.

  B1b'nin (nakil) iki sütunu da bu göçle gelir: `admissions.transfer_reason` ve `transfer_note`; onları
  nakil yazar (bkz. 3.20). **Geri alma** (`alembic downgrade 0017`) bu iki sütunu düşürür: B1b çıktıktan
  sonra her nakil nedeni ve şifreli notu kaybolur. Bir üyenin aynı kabulde iki kapalı satırı varsa eski
  kısıt geri kurulamaz ve geri alma bütünüyle durur. Göçün kapattığı ya da yazdığı satırlar geri
  alınmaz. Önce api, sonra web çıkar; eski bir imaj `0018`'e karşı yalnız iki yolda 500 verir (eski
  «üstlen» ve sorumlu hekim rolüyle ekleme), eski web ikisini de çağırmaz.
- **Sunucuya çıkmadan önce.** İki salt okunur sayım yapılır (yalnız sayı; ad ve kimlik yok): imzalı açık
  kabullerde adı geçen sorumlu hekimlerden hekim olmayanların sayısı (göç onlara da sorumlu hekim satırı
  yazar) ve kapanmamış kabullerde etkin sorumlu hekim satırı olup hekim olmayanların sayısı (eski
  «üstlen» yolu bir sorumlu hemşirenin hastayı almasına izin veriyordu). Sayı sıfır değilse çıkış durmaz:
  kutu o satırları olduğu gibi gösterir; sonra bir hekim hastayı üstlenir ya da bir sorumlu hekim onu
  sorumlu hekim rolüyle ekler, bu öncekinin satırını bitirir. Hangi hastanın önce bir hekime verileceğine
  sahip karar verir. Sorgular planın «Deploy notes» bölümündedir.
- **Bu dilimde olmayanlar:** süresi dolan nöbetçi satırlarının kendiliğinden kapanması (yeniden eklemek
  ya da «Ekipten çıkar» gerekir), birimi dışındaki üye için hasta ekranında kutu, açık pano akışına yeni
  üyeyi hemen bildirmek. (Ekibin nakilde taşınması B1b'de geldi, bkz. 3.20.)
- **Kaynak:** `docs/superpowers/specs/2026-11-09-g2b-b1c-bakim-ekibi-design.md` ve
  `docs/superpowers/plans/2026-11-09-g2b-b1c-bakim-ekibi.md`.

### 3.20 Nakil: hastayı başka yatağa tek adımda taşımak (Grup 2 · B1b)

Yatan bir hasta tek bir işlemle başka bir yatağa taşınır — aynı birimde ya da başka birimde. Hasta
Kabul'ün «Taburcu» sekmesi bu yüzden artık **«Nakil / Taburcu»**dur (ekranın alt başlığı «Kabul,
nakil ve taburcu»). **Durum:** kodda (`feat/g2b-b1b-nakil`); main'e ve hastane sunucusuna sahibin
sözüyle çıkar, ikisinde de henüz yok. Örneklerdeki adlar uydurmadır.

- **Kim yapar.** Hekim (`admissions.move.initiate`, taburcuyu da başlatan yetki: Sorumlu Hekim, Ünite
  Hekimi) ya da hemşire veya sorumlu hemşire (`admissions.transfer.confirm`) — gece hastayı kim
  taşıyorsa. İki yatak da kişinin birimlerinde olmalıdır: hastanın yattığı yatak ve gidilecek yatak.
  Sunucu ikisinin birimini de veritabanından kendisi okur; istek bir birim adı taşımaz (taşırsa 422).
  Bir birimin hekimi başka birimin hastasını kendi birimine taşıyamaz (eski yolun C-2 açığı): kapsam
  dışı yatak 403 `out_of_scope` alır. Yönetici her yerde (3.8). «Nakil» düğmesi «Yatan hastalar»
  listesinde iki izinden biriyle görünür; taslak (imzasız) hastada düğme yerine «Önce kabul
  imzalanmalı» yazar. Listeyi okumak `admissions.view` ister: nakil anahtarını taşıyan varsayılan
  gruplar onu da taşır, ama yalnız bir nakil anahtarı taşıyan, hastanenin yazdığı bir grup sekmeyi
  açar ve «Kabul kayıtlarını okuma yetkiniz yok» görür, «Nakil» düğmesini görmez.
- **Tek adım.** «Nakil et» denince tek bir işlemde eski kabul kapanır (`TRANSFERRED`), eski yatak
  temizliğe geçer («Temizlikte»), yeni yatakta yeni bir kabul kaydı açılır (`ACTIVE`) ve yeni yatak
  dolar. Arada bekleyen bir durum yazılmaz. Yeni kayıt eskisinin kimlik ve kabul bilgilerini aynen
  taşır; kabul saati nakil anıdır, taburcu alanları eski kayıtta kalır. Yalnız imzalı (`ACTIVE`) hasta
  taşınır: taslak önce bir hekimce imzalanır (3.19), taburcusu başlatılmış hasta taşınmaz (409
  `invalid_transition`). Hastanın kendi yatağı hedef olamaz (422 `field_invalid:target_bed_id`);
  kapalı yatak 409 `bed_closed`, boş olmayan yatak 409 `bed_not_available` verir.
- **Ne değişmez.** Protokol numarası (O8): eski kayıt numarayı yeni kayda verir, kendisi H-numarasıyla
  kalır; etiket, cihaza girilen numara ve kart aynı kalır. Kart ve monitör bağlantısı hastayla yeni
  yatağa geçer; eski yatağın monitörü artık kimseyi göstermez. Hastanın alarmları, onayları,
  ertelemeleri (3.21), kilosu ve eşlik eden hastalıkları aynı anahtarda kalır; elle yazılan görevleri,
  sıvı defteri ve RRT çağrıları da.
- **Bakım ekibi hastayla gider** (B1c, 3.19). Nakil anında etkin olan her satır — sorumlu hekimin
  satırı da — aynı rol, pencere ve atayanla yeni kabulde yazılır, eski kabuldeki satırlar kapanır.
  Nakilden önce ekipten çıkmış olanlar eski kabulde kalır: kutunun «Önceki üyeler» listesi nakille
  yeniden başlar (kayıtlar kaybolmaz; bir yatışın geçmişini gösteren ekran sonraki dilimdir).
- **Elde olan vardiya devri ve ölçüm saati de hastayla gider** (sahibin kararı, 10 Kasım 2026).
  - **Hangi devir.** Elde olan devir, açılmış ve 30 dakikası dolmamış ya da devreden imzalamış,
    karşı imzayı bekleyen devirdir (3.18). Nakilden sonra devir yeni kabul kaydını gösterir: yeni
    yatak, aynı kart. Tamamlanmış ya da süresi dolmuş devirler yazıldıkları gibi kalır.
  - **Devrin birimi.** Devir, hastanın yatağının birimindedir (3.18); hasta başka birime geçince
    devir de yeni birime geçer ve «Yönetici özeti» (3.24) onu orada sayar. Birden çok hastayı kapsayan
    bir devirde birim, devirdeki bütün hastalar yeni birimde yatınca geçer: ötekiler eski birimde
    kaldıysa devir eski birimde kalır ve son hasta da taşınınca yeni birime geçer.
  - **Kritik alarm kapısı** hastanın alarmlarını okumaya devam eder: onaylanmamış kritik alarm varken
    devreden imzası yine reddedilir. Hasta için sizin açtığınız, henüz imzalanmamış bir devir varsa
    «Vardiya devri» ekranı ikincisini açmaz, onu imzalatır; nakilden sonra da böyledir (bu denetim
    ekrandadır, sunucuda değil).
  - **Ölçüm saati.** Görevlerim'deki (3.16) vital ölçüm görevi, son 48 saatte elle ölçüm yoksa
    yatışın ilk kabul saatinden sayılır: nakil zinciri geriye, ilk kabule dek izlenir. Nakil bu saati
    sıfırlamaz; geciken bir görev nakilden sonra da gecikmiş görünür.
- **Neden ve not.** Altı nedenden biri seçilir: Klinik ihtiyaç, Yoğun bakıma, Yoğun bakımdan servise,
  İzolasyon, Hasta veya yakın isteği, Diğer. Not isteğe bağlıdır (en çok 200 karakter), «Diğer» için
  zorunludur; sunucu da bunu denetler (422 `field_invalid:note`). Neden ve not yeni kabul kaydında
  durur, not **şifreli**dir. Denetim kaydına neden ve yalnız «not yazıldı mı» düşer; notun metni ne
  denetim kaydına ne günlüğe düşer: not bir kişinin adını taşıyabilir.
- **Rezerve yatak.** Seçilebilir. Pencere önce rezervasyonun notunu gösterip sorar («Yine de bu yatağa
  naklet»). Onaysız rezerve yatağı sunucu da reddeder (409 `bed_reserved`): Doluluk'taki (3.14)
  kabulün kuralıdır. Yatak, seçici onu okuduktan sonra rezerve edilirse pencere yatakları yeniden
  okur ve yatak hâlâ sunuluyorsa o zaman sorar; bu arada alınmışsa ret söylenir ve odak yatağa gider.
  Nakille yatak dolar, rezervasyonun notu silinir.
- **Kritik alarm uyarır, tutmaz.** Hastada kimsenin onaylamadığı kritik bir alarm varsa pencere bunu
  söyler (pano yüklenmiş ve kişi panoyu okuyabiliyorsa), ama nakli durdurmaz: hasta çoğu zaman
  kötüleştiği için taşınır, ve alarmları onunla gider. Sunucu da aynı durumu cevapta ve denetim
  kaydında taşır.
- **Pencere.**
  - Yeni yatak seçici hastanın kendi biriminde açılır; hastanın kendi yatağı dolu olduğu için
    sunulmaz. Seçici bir yatağı sunmaz hale gelirse (yatak dolmuş, kapanmış) seçim düşer: gönderilen
    yatak hep ekranda görünendir.
  - Eksik alan varsa gönderilmez ve odak ilk eksik alana (neden, not, yatak) gider. «Nakil et»
    düğmesi yaptığı işi (eski yatak temizliğe geçer) ve varsa kritik alarm uyarısını ekran okuyucuya
    birlikte okutur. Yazma sürerken ve liste yeniden okunana dek düğmeler ve seçici kilitlidir.
  - Reddedilen nakil bildirimde yatağın adıyla görünür; not geçersizse pencere bunu kendi sözleriyle
    söyler. Nota ilişkin olmayan bir retten sonra yataklar yeniden okunur, düğmeler bundan sonra açılır.
  - Yanıt hiç gelmezse (zaman aşımı, sunucu hatası, kopan bağlantı) form kilitlenir ve nakil
    gerçekleşmiş olabileceğini söyler; düğme aynı nakli bir kez daha gönderir, bu arada yeniden okunan
    liste başka bir yatak gösterse de. Gerçekleşmişse sunucu ikinci bir nakil yapmaz, kartı yeniden
    taşır; gerçekleşmemişse nakli yapar. Sunucudan gelen bir ret kilidi bitirir.
  - Nakil bitince liste yeniden okunur, eski hastanın satırı gider ve odak hastanın yeni satırına
    gider (listede yoksa taburcusu başlatılanlar listesine).
- **Kart taşınamazsa.** Kayıt yine de yapılmıştır. Kart, işlem kaydedildikten sonra taşınır: önce eski
  yere (eski yatak ve birim, adsız) «hasta buradan gitti» karesi gider, sonra kart yeni yatağa konur;
  ekranlar kartın nereden gittiğini nereye gittiğinden önce duyar. Kart yeni yatağa konamadıysa
  «Nakil / Taburcu» sekmesi kalıcı bir not gösterir — «Kart yeni yatağa taşınamadı. Kart yeniden
  taşınana dek yeni birimin ekranları hastayı ve alarmlarını göstermez.» — ve «Kartı
  yeniden taşı» aynı nakli yeniden gönderir; sunucu veritabanına bir şey yazmadan kartı yeniden
  taşır (ikinci bir nakil olmaz, yanıt 200). Hasta bu arada yeniden nakledilmişse ya da taburcu
  edilmişse aynı istek reddedilir (409): eski yatağa hayalet bir kart konmaz. Böyle bir nakil artık
  hiçbir zaman yerine ulaşamayacağı için not da kalkar; hastanın daha yeni bir nakli de eski bir
  notu siler. Not yalnız sekmenin belleğindedir: dakikalık yeniden okumalardan etkilenmez, ama Kabul
  sekmesi değiştirilir ya da sayfa yenilenirse kaybolur. Tarayıcıda hiçbir yere kaydedilmez (içinde
  serbest metin olan nakil notu da bulunabilir). Not kaybolursa güvence, eski yatağın boşaltılmasıdır
  (aşağıda); o ana dek kart eski yatakta durabilir ve alarmları eski birimin ekranlarında görünür.
- **Kart yatakta kalırsa yatak boşalmaz.** Eski yatak temizlikten boşa alınırken (ve yöneticinin ham
  geçişinde, kullanıma açılırken) hastanın kartı hâlâ o yatakta duruyorsa yeniden taşınmaya çalışılır;
  taşınamazsa yatak boşalmaz (`board_not_cleared`) ve yeni bir hasta yatırılamaz, böylece bir yatakta
  iki kart olmaz. Hasta hâlâ yattığı için kart asla panodan kaldırılmaz. Tek istisna: hasta bu arada
  taburcu olmuş ve kartı hâlâ eski yatakta duruyorsa o artık taburcu bir hastanın kartıdır, boşaltma
  onu panodan kaldırır (3.8).
- **Denetim.** Her nakil bir `admission.transfer` satırı yazar: eski ve yeni kabulün ve yatağın ve
  birimin kimliği, taşınan protokol, neden, not yazıldı mı, açık kritik alarm var mıydı, yatak
  rezerve miydi (yalnız öyleyse), kaç bakım ekibi satırı ve kaç vardiya devri taşındı, taşınan
  devirlerin kimlikleri ve kimin yaptığı. Hasta adı ve notun metni yoktur. Kartı yeniden taşıma
  (düğme ya da yatağın boşaltılması) `admission.transfer_board_retry` satırı yazar. «Denetim
  bütünlüğü» sayfası (3.13) ikisini «Hasta başka yatağa nakledildi» ve «Kart yeni yatağa yeniden
  taşınmaya çalışıldı» adıyla gösterir ve «Tür» süzgecinde sunar. Denetim kaydı yazılamazsa günlük
  satırı yalnız kapanan ve açılan kabulün kimliğini taşır, devir kimliklerini taşımaz.
- **Hasta ekranı açıkken.** Açık bir hasta ekranı açık kabulleri dakikada bir okur (3.19); nakilden
  sonra bir sonraki okumasına dek (en çok bir dakika) eski kabulü tutar. O aralıkta bakım ekibine
  yazılan bir işlem ve etiket yeniden basımı reddedilir (eski kabul `TRANSFERRED` ve protokol yeni
  kabulde); ret bildirimde görünür, sonraki okumada ekran yeni kabulü gösterir. Böyle bir retten sonra
  hasta ekranının yeniden okuması sonraki dilime kaldı.
- **Göç.** Kendi göçü yoktur: neden ve not sütunları B1c'nin `0018` göçüyle gelir (iki dilim tek göç
  paylaşır); main'de göç zincirinin başı `0019`dur (Eczane).
- **Henüz yok.** Doluluk ekranındaki dolu yataktan nakil; yanlış yatağa açılmış taslağı düzeltmek;
  nakli alan hekimin bir saat içindeki onayı (S-27); yeni yatakta hemşire ataması; HBYS'ye bildirim;
  başka hastaneye nakil (o bir taburcudur: başka kuruma sevk); bir yatışın nakil geçmişini gösteren
  ekran.
- **Kaynak:** `docs/superpowers/specs/2026-11-09-g2b-b1b-nakil-design.md` ve
  `docs/superpowers/plans/2026-11-09-g2b-b1b-nakil.md`.

### 3.21 Alarm erteleme: «Ertele» (Grup 2 · B5b)

- **Ne:** Alarmlar ekranında bir alarmı sınırlı bir süre için susturmak. Erteleme bir kişinin gerekçeli ve süreli
  kararıdır; alarm panodan kalkmaz.
- **Durum:** 11 Kasım 2026'dan beri hastane sunucusunda çalışıyor (göç yok).
- **Sahip kararı (kurallar):**
  - **Kritik alarm hiç ertelenmez.** Ekran bunu bir kez, cevap bekleyen ilk kritik alarmın yanında yazar: «Kritik
    alarm ertelenemez».
  - **Yüksek alarm** en çok 30 dk ertelenir (5/10/15/30 dk), **orta alarm** en çok 120 dk (15/30/60/120 dk).
  - **Düşük ve bilgi alarmı ertelenmez;** zaten ses çıkarmazlar.
  - **Gerekçe zorunludur** ve listeden seçilir: klinik karar verildi, artefakt ya da sinyal gürültüsü, işlem sürüyor,
    hastanın kendi normali, diğer. «Diğer» 15–500 karakterlik bir açıklama ister; açıklamaya ad ya da kimlik
    numarası yazılmaz.
  - **Kim:** alarmı onaylayabilen (`alerts.ack`) herkes, hemşire dahil. Cihaz jetonu reddedilir; ertelemeyi bir kişi
    yapar.
- **Ertelenen alarm:**
  - Ses çıkarmaz; zilde, menü rozetinde, kilit ekranının sayısında, Yataklar ekranının «Yanıt bekleyen alarm»
    satırında ve RRT ekranının «yoldaki» listesinde sayılmaz.
  - Eskale olmaz. Önceden eskale olduysa «Eskale edildi» işareti kalkar; hekime giden bildirim geri alınmaz.
  - Alarmlar ekranında «Ertelenenler» grubuna geçer: bitiş saati, erteleyen ve gerekçesiyle. «Gördüm», «RRT çağır»
    ve «Ertele» yine kullanılabilir.
- **Süre bitince:** alarm yeniden cevap bekler ve çalar. Ekran bunu kendi saatiyle yapar, sunucuyu beklemez; sunucu da
  kartı yeniden yayınlar. Eskalasyon saati bitişten yeniden başlar ve hekim bildirimi sıfırlanır: alarm bundan sonra
  5 dk cevapsız kalırsa eskale olur ve hekime yeniden bildirim gider, erteleme öncesinde bildirim gitmiş olsa bile.
  Eskale olan yalnız acil (`immediate`) alarmlardır (§3.15).
- **Erteleme erken biter:** «Gördüm» ile; alarm kapanınca (gidip gelen alarm yeni bir alarmdır ve çalar, erteleme
  eskalasyon zinciriyle taşınmaz); taburcu ile; aynı alarm kötüleşince (ör. NEWS2 orta → yüksek: kötüleşen alarm
  hemen çalar, eskalasyon saati yeniden başlamaz); yeniden ertelemeyle (yenisi eskisinin yerine geçer).
- **Kayıt:** her erteleme denetim kaydına `alert_snooze` olarak, erteleyenin adı, süre, bitiş ve gerekçeyle yazılır;
  kayıt belleğe yazılmadan önce düşülür. Denetim sayfasında «Alarm ertelendi» olarak görünür.
- **API yeniden başlarsa:** süresi dolmamış erteleme denetim kaydından geri gelir; süresi dolmuş olan geri gelmez.
- **Bu dilimde olmayanlar:** birime göre erteleme kuralları, kritik alarmı erteleme, hasta ekranından erteleme,
  erteleme raporu. Postgres'teki eski `escalation/` modülüne dokunulmadı.
- **Kaynak:** `docs/superpowers/specs/2026-11-10-g2b-b5b-ertele-design.md`.

### 3.22 «Cihaz & Veri Akışı»: veri geliyor mu? (Grup 4 · G4-01)

- **Ne:** Sol raydaki **«Cihazlar»** sayfası (eski adı «Monitörler»; Azerbaycanca «Cihazlar», Rusça
  «Устройства» — telefonun dar rayında «Устр.» —, İngilizce «Devices») önce tek bir soruyu yanıtlar:
  **veri geliyor mu?** Sayfanın başlığı «Cihaz & Veri Akışı». Adresi (`/devices`), simgesi ve yetkileri
  değişmedi; rehberin önceki bölümleri (ör. 3.9, 3.11) ekranı eski adıyla anar, aynı ekrandır.
- **Durum:** 11 Kasım 2026'dan beri hastane sunucusunda çalışıyor (göç yok).
- **Kim görür:** cihaz yönetimi yetkisi (`devices.manage`: Biyomedikal Teknisyen, Üretici Destek;
  Sistem Yöneticisi her yetkiyi taşır) ya da monitör–yatak eşleme yetkisi (`devices.map_beds`: Sorumlu
  Hemşire) olan herkes. Biyomedikal Teknisyen ve Üretici Destek girişte bu sayfaya düşer. Yalnız panoyu
  görme yetkisi (`board.view`) olan hekim ve hemşire ekranı görmez. Kapsamı birimleriyle sınırlı biri
  (ör. sorumlu hemşire) yalnız kendi yataklarının monitörlerini görür, sayılar da yalnız onları sayar;
  atanmamış cihazları yalnız cihaz yönetimi yetkisi ya da sınırsız kapsamı olan görür. Eşleme yetkisi
  olup ne cihaz yönetimi ne pano yetkisi olan bir oturum ilk dört bölümü görmez: yerlerinde «Veri akışı
  bölümleri cihaz yönetimi ya da pano görüntüleme yetkisi ister» notu durur; 5. bölümü ve eşleme
  bölümünü görür. Sayfa hiçbir hasta bilgisi göstermez.
- **Sayfanın sırası (yukarıdan aşağı):**
  1. **«Veri geliyor mu?»** Tek satırlık hüküm, altında sayılar ve izleme satırı.
     - Önce veri zinciri. Zincir kopuksa hüküm zincirindir: «Veri gelmiyor: aktarıcı 4 dk'dır sessiz»,
       «Veri gelmiyor: toplayıcı bağlı değil», «Henüz hiç veri gelmedi»; zincirin durumu tanınmıyorsa
       «Veri akışının durumu okunamıyor». O zaman bütün monitörler aynı nedenle susar; 2. ve 3. bölüm
       onları tek tek arıza diye listelemez.
     - Zincir çalışıyorsa hüküm monitörlerindir. En az bir monitör veri gönderiyorsa «Veri akıyor · 5/6
       monitör veri gönderiyor»; hiçbiri göndermiyorsa «Zincir çalışıyor, ama hiçbir monitör veri
       göndermiyor»; bu görünümde hiç monitör yoksa (hub hiç bildirmiyor ya da yetkinizin olduğu
       yataklarda monitör yok) «Bu görünümde monitör yok»; monitör sayıları yanıtta okunamıyorsa «Zincir çalışıyor; monitör sayıları
       okunamıyor».
     - Sayılar yalnız ilk iki hükmün altında yazılır, yalnız sıfırdan büyükler, bu sırayla: sessiz,
       eskiyen kanal (3. bölümde listelenenler), beklemede, veri bekliyor, atanmamış.
     - En altta: «İzleme başlangıcı 10:42 · sistem yeniden başlayınca sıfırlanır».
  2. **«Sessiz monitörler».** Sessiz monitörler (hub o monitörden 3 saniyedir paket almıyor) ve haber
     alınamayanlar (Infinity sunucusu — hub — onu 15 saniyeden uzun süredir bildirmiyor; hub'ın
     listesinden çıkan monitör böyledir); en uzun süredir susan en üstte, son verisinin zamanı
     bilinmeyen en altta. Her satır: yatağın adı (yatağı yoksa cihazın adresi), «{n} dk'dır veri yok ·
     son veri {SS:DD}». Hub'ın listesinden çıkan monitörün satırında «hub artık bildirmiyor» da yazar;
     sunucu onun zamanlarını son bildiriminden sonra 24 saat tutar, sonra satır API yeniden başlayana
     dek yalnız «son verinin zamanı bilinmiyor» der.
  3. **«Eskiyen kanallar».** Veri gönderen bir monitörün en az bir dakikadır geçerli değer taşımayan
     kanalları (ör. ART S, SpO₂), bir saat dolana dek. Her satır bir monitördür: yatağın adı (yatağı
     yoksa adresi), ardından kanalları — «ART S · 4 dk'dır değer yok» —, en eskisi önce; en eski kanalı
     olan monitör en üstte. 15 saniyeyi aşan her boşluğu şerit zaten gösterir; burada yalnız bir
     dakikayı bulanlar listelenir. Bir saat dolunca kanal listeden çıkar: o kadar uzun susan bir kanal
     büyük olasılıkla bilerek çıkarılmıştır (ör. arter kateteri alınınca ART). Bölüm böyle kanalları
     sonda tek satırda sayar — «2 kanal 1 saatten uzun süredir değer göndermiyor (çıkarılmış
     olabilir)» —; hiç yoksa ya da bölüm listeleyemiyorsa bu satır yazılmaz. Sunucu kanalı unutmaz;
     yalnız liste onu artık göstermez. **NBP ne listelenir ne sayılır** (değeri yalnız manşon ölçünce
     gelir). Yalnız veri gönderen monitörün kanalları listelenir: beklemedeki monitörün (açık ama
     ölçmüyor) eskiyen kanalı olmaz, o 1. bölümde ayrıca sayılır; susan monitör 2. bölümdedir.
  4. **«Veri zinciri».** Toplayıcı (bağlı mı, son sinyal ne kadar önce), aktarıcı (son gönderi,
     gönderilen ve başarısız), Infinity sunucusunun aldığı ve eski ya da yinelenen paketler, nedenine
     göre reddedilen değerler (bu sürümün tanımadığı nedenler «diğer» diye toplanır). Her satırın durum
     sözcüğü vardır: normal, durmuş, dikkat (reddedilen değer varsa), bilinmiyor. Zincir kopukken de
     görünür: hangi halkanın durduğunu bu bölüm söyler.
  5. **«Tabloda var, hiç görülmedi».** Cihaz→yatak tablosunda olup hub'ın, sistem açıldığından beri hiç
     bildirmediği monitörler: yatak ve cihaz adresiyle. Liste, aşağıdaki eşleme bölümünün okuduğu
     listedir; sayfa onu bir kez ister. Bu bölüm şeritten bağımsızdır: şerit kapalıyken, henüz
     okunmamışken ya da oturum şeridi göremezken de görünür. Liste yüklenirken «Eşleme listesi
     yükleniyor…» der; «Tabloda olup hiç görülmeyen monitör yok» sözünü yalnız yanıt veren bir liste
     söyler; liste okunamazsa ya da monitör hattı kapalıysa son satırlarını korur ve «Eşleme listesi
     okunamadı; birazdan yeniden denenecek.» der.
  6. Sonra, değişmeden: monitör–yatak eşleme bölümü (3.9) ve her monitörün şeridi. Şerit kapalıyken ya
     da henüz hiç okunamamışken ilk dört bölüm görünmez.
- **2. ve 3. bölüm listeleyemezse** nedenini söyler, asla «yok» demez:
  - zincir kopuksa: «Veri zinciri kesik: monitörler tek tek listelenmiyor»;
  - zincirin durumu ya da monitör sayıları bilinmiyorsa: «Veri akışının durumu bilinmiyor: monitörler
    tek tek değerlendirilemiyor»;
  - bu görünümde monitör yoksa: «Bu görünümde monitör olmadığı için değerlendirilemiyor»;
  - yanıtta «ne zamandan beri» bilgisi yoksa (eski bir API sürümü ya da sunucunun okuyamadığı hafıza,
    aşağıda): «Bu sürüm «ne zamandan beri» bilgisini vermiyor» — 2. bölüm sessiz monitörleri o zaman
    yalnız durumlarıyla, zamansız listeler;
  - yanıtın zamanı yoksa: «Yanıtın zamanı yok: süreler hesaplanamıyor».
- **Süreler:** 1–3. bölümlerde tam dakika, aşağı yuvarlanarak («4 dk'dır» en az 4 dakika demektir); bir
  dakikadan kısa süre «<1 dk'dır». Süreler sunucunun saatiyle sayılır ve pano güncelken iki okuma
  arasında da ilerler; tarayıcının saati yanlış olsa da bir sessizliği kısaltamaz. Veri zincirinin
  yaşları şeritteki gibi saniye ya da dakikayla yazılır. Saatler (SS:DD) bu tarayıcının yerel saatidir.
- **Pano güncel değilse** (son başarılı okuma 15 saniyeden eskiyse ya da son okuma başarısızsa) sayfa
  «her şey yolunda» demez:
  - «Veri geliyor mu?» bölümü «Pano güncel değil · son yanıt 10:47» satırıyla başlar; son hüküm geçmiş
    zamanla gelir («Son yanıtta veri akıyordu · 5/6 monitör veri gönderiyordu»).
  - Listeler, sayılar ve süreler son yanıtın anında donar: son yanıtın söylemediği hiçbir kanal, sayı
    ya da dakika eklenmez.
  - Veri zincirinin satırları son değerlerini korur; durum sözcükleri «bilinmiyor» olur.
  - Sessiz monitörler, eskiyen kanallar ve veri zinciri bölümlerinin altında «Pano güncel değil ·
    10:47» yazar ve hiçbiri «yok» demez — boş bir listeyi yalnız güncel bir okuma söyleyebilir. 5. bölüm
    kendi listesine bakar (yukarıda).
- **Ekran okuyucu:** görünmeyen bir durum satırı yalnız hükmü — dakika ve sayı olmadan — ve pano güncel
  değilse «Pano güncel değil»i taşır; ekran okuyucu böylece durum değişince konuşur, her dakika değil.
- **Neyi hatırlar:** sunucu her monitörü ve her kanalını en son ne zaman gördüğünü yalnız bellekte
  tutar. Veritabanına bir şey yazılmaz, göç (migration) yoktur, hub değişmedi. API yeniden başlarsa bu
  hafıza sıfırlanır; sayfa bunu «İzleme başlangıcı …» satırıyla söyler. NBP için tutulan zaman,
  değerinin son değiştiği andır: manşon o an ya da daha önce ölçmüştür (NBP yine hiçbir listeye
  girmez). Sunucunun saati geri alınırsa (NTP düzeltmesi, sanal makinenin geri yüklenmesi), saatin
  2 saniyeden fazla ilerisinde kalan zamanlar silinir ve bilinmiyor sayılır. Hafıza okunamazsa pano
  G4-01'den önceki gibi yanıt verir: hemşirelerin şeridi etkilenmez, bu sayfa yukarıdaki «ne zamandan
  beri» nedenini söyler. Değerlerin kendisi, 120 saniyelik unutma süresi ve gölge motorun okuduğu
  hiçbir şey değişmedi.
- **Bu dilimde olmayanlar:** cihaz envanteri ve bakım (tip, seri numarası, bakım, kalibrasyon, arıza,
  pil), alarm kalitesi paneli, yeniden başlatmalar arası sessizlik geçmişi, sessiz monitör için
  bildirim ya da ray rozeti, klinik panonun «besleme sağlığı» göstergesinin biyomedikale açılması, hub
  ya da toplayıcı değişikliği.
- **Kaynak:** `docs/superpowers/specs/2026-11-11-g4-cihaz-veri-akisi-design.md`.

### 3.23 «Eczane»: eczacının servis sayfası (Grup 3 · G3-04)

- **Ne:** Sol raydaki **«Eczane»** sayfası (`/eczane`; Azerbaycanca «Aptek», Rusça «Аптека», İngilizce «Pharmacy»).
  Kullanıcının kapsamındaki her yatan hasta tek tabloda: vazopresör ve inotroplar, antibiyotik durumu, kreatinin ve
  bugünkü sıvı dengesi. Sayfa izleme içindir ve yalnız okur: buradan kayıt girilmez, sayfa doz önermez, order vermez,
  tanı koymaz. Başlığın altında bunu söyler: «Bu ekran izleme içindir; doz önermez, order vermez.» Sistem yeni bir
  veri toplamaz; sayfa, zaten tuttuklarını (panodaki ilaç bloğu ve sıvı defteri) bir araya getirir. Örneklerdeki
  değerler uydurmadır.
- **Durum:** 11 Kasım 2026'dan beri hastane sunucusunda çalışıyor (göç 0019).
- **Kim görür:** yeni yetki `pharmacy.view` olan. Varsayılan olarak Eczacı, Sorumlu Hekim, Ünite Hekimi ve Hekim
  gruplarında; Sistem Yöneticisi her yetkiyi kural gereği taşır. Hemşire, Sorumlu Hemşire, Hızlı Yanıt Ekibi,
  Denetçi, Biyomedikal Teknisyen ve Üretici Destek görmez. Başka bir gruba Yönetim › Roller ve yetkiler'den kodsuz
  verilebilir. Eczacının birimleri herkesinki gibi Yönetim › Kullanıcılar'dan atanır; sayfa yalnız o birimlerin
  hastalarını gösterir ve kapsam dışında kalan kart varsa bunu söyler. Rayda «Vardiya devri»nden sonra, «Yönetici
  özeti»nden önce gelir; kimsenin giriş sayfası değişmedi. Yalnız bu yetkiyi taşıyan bir hesap bu sayfaya düşer.
- **Sayfanın sırası (yukarıdan aşağı):**
  1. **Başlık** «Eczane» ve tek cümlesi.
  2. **Dört sayaç** (sayıları sunucu gönderir): «Süre işliyor», «Süre aştı», «Vazopresör / inotrop alan» ve «Sepsis
     tanınan» (altında «sayılan uygulama kaydı yok: n»; n her zaman ilk iki sayacın toplamıdır, çünkü sepsisi tanınmış ve
     sayılan bir uygulaması olmayan hasta tam olarak süresi işleyen ya da aşan hastadır).
  3. **Not** (sayfada her durumda durur): «“Kayıt yok” ve “uygulama kaydı yok”, bu sisteme antibiyotik uygulaması
     kaydedilmediğini söyler; verilmediği anlamına gelmez.» Yani bu sözler «verilmedi» demek değildir: antibiyotik
     başka bir yerde verilmiş ve buraya yazılmamış olabilir. Sayfa hiçbir hücrede, sayaçta ya da notta böyle bir
     hüküm vermez.
  4. **Tablo.** Sıra sunucunundur: önce antibiyotik süresi işleyen ya da aşan hastalar (en çok aşan en üstte, sonra en
     az süresi kalan), sonra vazopresör ya da inotrop alan diğer hastalar, sonra geri kalanlar; her grubun içinde
     panonun yatak sırası (birim, sonra yatak adı; «YBU 1-2», «YBU 1-10»dan önce gelir ve Ç, Ö, Ş gibi harfler
     işaretsiz harfiyle birlikte sıralanır). Sütunlar:
     - **«Yatak · hasta»:** yatak ve ad. Panoyu görme yetkisi (`board.view`) olan için ikisi birlikte hasta ekranına
       tek bağlantıdır; ayrıntı ve kayıt girişi oradadır. Bu yetkisi olmayan aynı yazıyı bağlantısız görür.
     - **«Vazopresör / inotrop»:** hızı kaydedilmiş her ilaç, hızı ve ne kadar önce kaydedildiği («noradrenalin 0.12
       µg/kg/dk · 12 dk önce»); hız 0 ise «durduruldu». İlaç kutusunun kendi cümleleridir (§3.6). Kayıt ne kadar
       eski olursa olsun sayfa hızı yargılamaz. Hiç kayıt yoksa «Kayıt yok».
     - **«Antibiyotik»:** altı durumdan biri, sayfanın kendi sözleriyle:
       - «Süre işliyor · 35 dk kaldı»: sepsis tanındı, 1 saatlik süre henüz dolmadı, sayılan bir uygulama kaydı yok.
       - «Süre aştı · 25 dk»: süre doldu, sayılan bir uygulama kaydı hâlâ yok.
       - «Karşılandı · SS:DD»: sepsis tanındı, kayıtlı uygulama saati süre içinde.
       - «Geç verildi · SS:DD»: sepsis tanındı, kayıtlı uygulama saati süre dolduktan sonra.
       - «Verildi · SS:DD»: sepsis tanınmamış, ama bir uygulama kaydı var.
       - «Kayıt yok»: sepsis tanınmamış ve sayılan bir uygulama kaydı yok.

       «Karşılandı», «Geç verildi» ve «Verildi»deki saat, uygulamanın kaydedilen saatidir. İlk iki durumun («Süre
       işliyor», «Süre aştı») altında ikinci bir satır durur. Hiçbir şey kaydedilmemişse «tanınma SS:DD · uygulama
       kaydı yok». Bir şey kaydedilmiş, ama motorun kuralı onu saymıyorsa (tanınmadan **önce** damgalanmış bir doz
       ya da «0» olarak girilmiş bir uygulama) «tanınma SS:DD · tanınmadan sonra sayılan uygulama kaydı yok». Bu
       ikinci cümle bir kaydın var olduğunu, ama sepsis tanındıktan sonra sayılan bir uygulamanın kaydedilmediğini
       söyler. Durum sözcüğü, renk, süre ve sayaçlar iki halde de aynıdır ve 3. maddedeki not ikisi için de
       geçerlidir.
     - **«Kreatinin»:** son değer ve saati («1.4 mg/dL · 06:10»). Renk, eşik, eğilim ya da eGFR yok. Hiç ölçüm yoksa
       «Kayıt yok».
     - **«Bugünkü sıvı dengesi»:** sıvı gününün dengesi işaretiyle («+250 mL»), altında aldığı, çıkardığı ve son
       girişin saati («aldığı 850 mL · çıkardığı 600 mL · son giriş 09:00»). Sıvı günü takvim günü değildir:
       Görevlerim'in ilk nöbet başlangıcında başlar (varsayılan 08:00, kurumun saatiyle; §3.17) ve 24 saat sürer.
       Sütun başlığının altında günün ne zaman başladığı yazar: «gün başlangıcı 08:00» (gün dün başladıysa saat
       tarihiyle yazılır). O gün hiç kayıt yoksa «Bugün kayıt yok» yazar, asla «0 mL» değil: kaydedilmemiş bir gün
       sıfır denge demek değildir.
  5. **Kaynak satırı:** «Antibiyotik süresi: motorun sepsis ya da septik şok kuralının ilk tetiklendiği andan
     itibaren 1 saat — Surviving Sepsis Campaign 2026 (güçlü öneri, çok düşük kesinlikte kanıt).»
  6. **Alt not:** «Bu sayfada yok: order'lar, alerjiler, kültür sonuçları, ilaç etkileşim sorgusu, antibiyotik tedavi
     günü, doz önerisi. Homunculus tanı koymaz, order vermez.»
- **Antibiyotik süresi nasıl işler.** Sayfadaki tek kaynaklı sayı budur: 1 saat. Sıfır anı, motorun sepsis ya da
  septik şok kuralının bu yatışta ilk tetiklendiği andır; saat o anda başlar (alarm panoda görünmese de işlemeye
  devam eder). Kaynağı Surviving Sepsis Campaign 2026'dır ve iki yarısı vardır: kılavuz bunu **güçlü bir öneri**
  olarak verir, ama dayandığı **kanıtın kesinliği çok düşüktür**. Bunlar iki ayrı şeydir ve sayfa ikisini de söyler.
  Tanınmadan sonra kaydedilen bir uygulama saati yanıtlar: süre içindeyse «Karşılandı», sonraysa «Geç verildi».
  Tanınmadan **önce** kaydedilmiş bir doz saati durdurmaz (motorun kuralı böyledir, alarm da aynı şekilde çalar): o
  hasta burada «Süre işliyor» ya da «Süre aştı» okur ve altında «tanınmadan sonra sayılan uygulama kaydı yok»
  yazar. «0» olarak kaydedilmiş bir uygulama da aynı şekilde okunur. Kimsenin yanıtlamadığı bir saat, enfeksiyon
  şüphesi «yok» diye kaydedilene ya da hasta taburcu edilene kadar «Süre aştı» kalır ve listenin başında durur.
- **Renkler.** Yalnız motorun iki alarm şiddeti: «Süre aştı» kritik, «Süre işliyor» yüksek; ilk iki sayaç da yalnız
  sayısı sıfırdan büyükken bu renkleri alır. Başka hiçbir şey renkli değildir ve hiçbir şey yeşil değildir.
  Kreatinin ve sıvı dengesi yalnız sayı ve saattir: kasada böbrek dozu eşiği ya da sıvı dengesi hedefi için kaynak
  yok, bu yüzden sayfa ikisini de yargılamaz.
- **Ne zaman okunur.** Her 30 saniyede bir. Sekme gizliyken okumaz; yeniden görünür olunca hemen okur. İki okuma
  arasında süreler ve «… önce» yaşları sayfanın saatiyle ilerler. Bu saat her oturumda sunucunun saatine göre
  düzeltilir; panoyu görme yetkisi olmayan, yalnız `pharmacy.view` taşıyan bir hesapta da (o zaman düzeltme sayfanın
  kendi yanıtlarından ölçülür). İş istasyonunun saati ileri ya da geri olsa da dakikalar ve listenin güncel olup
  olmadığı sunucunun saatiyle belirlenir. Durum sözcüğü ise her zaman sunucunundur: süresi iki okuma arasında dolan
  bir satır, sunucu «aştı» diyene kadar «Süre işliyor · <1 dk kaldı» okur.
- **Liste güncel değilse.** Okuma başarısız olursa (sunucu hatası, zaman aşımı, ağ kesintisi, kapsamın
  okunamaması) ya da son yanıt 90 saniyeden eskiyse sayfanın başında «Eczane listesi güncel değil · son yanıt SS:DD»
  ve varsa nedeni yazar. Satırlar son yanıttaki gibi kalır; sayaçlar «son yanıt SS:DD itibarıyla» notuyla durur;
  süreler saymayı bırakıp geçmiş zamanla yazılır («Son yanıtta süre işliyordu · bitiş SS:DD», «Son yanıtta süre
  aşılmıştı · bitiş SS:DD»); vazopresör yaşları kayıt saatine döner. Son yanıtta hiç hasta yoksa sayfa yalnız güncel
  olmadığını söyler: sayaç da çizilmez, çünkü dört «0» sakin bir servis gibi okunurdu. «Görünümünüzde yatan hasta
  yok.» cümlesini yalnız güncel bir yanıt söyler.
- **Liste okunamazsa.** İlk okuma sürerken «Eczane listesi okunuyor…» yazar. Hiç yanıt alınamadıysa «Eczane listesi
  okunamadı: {neden}» yazar; sayaç ve tablo çizilmez, asla sıfır yazılmaz.
- **Yetki geri alınırsa ya da oturum biterse.** Sunucu okumayı reddederse (yetki oturum açıkken geri alındı ya da
  oturum artık geçerli değil) sayfa elindeki listeyi hemen bırakır: yalnız «Eczane listesi okunamadı: …» ve nedeni
  kalır (ör. «Bu işlem için yetkiniz yok (pharmacy.view).»); sayaç, tablo, hasta adı ve yatak ekranda kalmaz. Sunucu
  hatası, zaman aşımı ya da ağ kesintisi böyle değildir: onlar kullanıcının hakkı için bir şey söylemez, liste
  «güncel değil» uyarısıyla kalır.
- **Sıvı okuması kesilirse.** Günün sıvı kayıtları sunucunun okuma sınırını (20 000 satır) aşarsa tablonun üstünde
  «Sıvı toplamları gösterilemiyor: günün kayıtları okuma sınırını aştı.» yazar ve her satırın sıvı hücresi «—» olur:
  ne denge, ne aldığı ve çıkardığı, ne de «Bugün kayıt yok». Kesilen okuma günün en eski kayıtlarını düşürür; o
  zaman yazılacak bir denge eksik, «Bugün kayıt yok» ise yanlış olabilirdi. Sayfa bilmediği sayıyı yazmaz.
- **Sunucuda.** Yeni `GET /pharmacy` (`pharmacy.view`): satırlar çağıranın kapsamındaki pano kartlarından kurulur
  (`/patients` ile aynı kapsam kuralı; Kabul'den taburcu edilmiş hasta ikisinde de yoktur). Her satırın durumu,
  satırların sırası, dört sayaç ve sıvı toplamları sunucuda hesaplanır; tarayıcı toplamaz, sıralamaz, yargılamaz.
  Sıvı defteri istek başına bir kez okunur (hasta başına değil); kapsamda hiç hasta yoksa hiç okunmaz. Liste
  okuması denetim kaydına yazılmaz (pano okuması gibi; 30 saniyede bir okuma kaydı gömerdi); bir hastayı satırdan
  açmak her zamanki «görüntüleme» kaydını yazar. Pano kartının ilaç bloğuna kreatininin saati eklendi
  (`creatinine_at`). Göç **0019** yalnız yetki satırları yazar (dört varsayılan gruba `pharmacy.view`; 0018'den
  sonra gelir); tablo ya da sütun eklemez.
- **Bu sayfada ve bu dilimde olmayanlar:** order'lar, alerjiler, kültür sonuçları, ilaç etkileşim sorgusu,
  antibiyotik tedavi günü sayımı, doz önerisi; bu sayfadan kayıt girme; bildirim ya da ray rozeti; yazdırma; son
  tamamlanan günün sıvı dengesi (gün döndükten hemen sonra sütun boştur).
- **Açık:** Azerbaycanca, Rusça ve İngilizce metinler yerel okuma bekliyor. Tanınmadan önceki bir dozun saati
  durdurup durdurmayacağı kasada açık bir sorudur; kaynak olmadan değişmez. Yanıtsız kalan bir saatin «Süre aştı»
  olarak en üstte kalması pilotun ilk haftasından sonra yeniden bakılacak. Kreatinin için böbrek dozu eşiği, sıvı
  dengesi hedefi ve bir vazopresör hızının ne kadar eski olabileceği: her biri önce kasada bir kaynak ister.
  Kurumun bütün sıvı kayıtlarını okuyan sorgunun maliyeti denetim kaydı büyüdükçe artar (bugün kayıt küçük);
  sonraki bir dilimin işidir. Eczacı grubunun açıklama metni («Pano ve kabul kayıtlarını okuma.») değişmedi;
  değiştirmek ayrı bir göç ister ve sahibin kararıdır.
- **Kaynak:** `docs/superpowers/specs/2026-11-11-g3-eczane-design.md`; plan
  `docs/superpowers/plans/2026-11-11-g3-eczane.md`.

### 3.24 «Yönetici özeti»: hastane bir bakışta (Grup 4 · G4-02)

- **Ne:** Sol raydaki **«Yönetici özeti»** sayfası (`/ozet`; Azerbaycanca «Rəhbər xülasəsi», Rusça «Сводка для
  руководства», İngilizce «Management summary»; telefonun dar rayında «Özet»). Hastanenin şu anki durumu ve alarm
  kalitesi tek sayfada, yalnız gerçek verilerden. Sayfa yalnız okur ve hiçbir yerde hasta adı ya da kimliği göstermez.
- **Durum:** 11 Kasım 2026'dan beri hastane sunucusunda çalışıyor (göç yok).
- **Kim görür:** yeni yetki `summary.view` («Yönetici özetini görür») olan. Varsayılan gruplardan hiçbirinde yok;
  Sistem Yöneticisi her yetkiyi kural gereği taşıdığından yalnız o görür, göç (migration) gerekmedi. Başka bir gruba
  (ör. başhekim) Yönetim › Roller ve yetkiler'den kodsuz verilebilir; o grup bir kaynağın kendi yetkisini taşımıyorsa
  o sütun ya da kart sayı yerine «yetki yok» der (yapıyı okuma yetkisi yoksa birim tablosunun yerinde «Birim
  satırları yazılamıyor · yetki yok» yazar). Rayda «Eczane»den (§3.23) sonra gelir; kimsenin giriş sayfası
  değişmedi (Sistem Yöneticisi yine «Yataklar»a düşer). Bir çalışma ekranı değildir: yalnız `summary.view` taşıyan
  bir hesap bununla oturum açamaz (giriş ekranı «Hesabınızın yetkileri bu arayüzdeki ekranlardan hiçbirini
  açmıyor…» der, §3.5); ona bir çalışma yetkisi de (ör. panoyu görme, `board.view`) verilmelidir.
- **Sayfanın sırası (yukarıdan aşağı):**
  1. **Başlık:** «Yönetici özeti», son tam okumanın saati («10:42 itibarıyla») ve «Yenile» düğmesi. Tam okuma,
     sayfanın kendi okumalarından (yapı, görevler, bekleyen devirler, kullanıcının kendi kapsamı) oturumun
     okuyabildiği her birinin yanıt verdiği son turdur; henüz yoksa «Henüz tam bir okuma yok» yazar.
  2. **«Unutulan işler»:** dört kart; her biri bir sayı, neyi saydığını söyleyen bir satır ve kaynağının okunduğu
     saat («son okuma 10:42»).
     - **«Yanıtsız kalan alarm · {dönem}»:** seçilen dönemde hiç yanıtlanmamış ve en az 10 dakikalık alarm olayları.
       10 dakika motorun rapor sınırıdır (5 dakikalık eskalasyonun iki katı); kart bunu söyler. Sunucunun okuma sınırı
       aşıldıysa sayı eksiktir ve kart bunu «eksik okuma: yalnız en yeni kayıtlar sayıldı» diye söyler.
     - **«Karşı imzası bekleyen devir»:** devredenin imzaladığı, devralanın henüz karşı imzalamadığı devirler ve
       «en eskisi {n} dk / saat / gün önce» (sunucunun saatiyle, aşağı yuvarlanarak). Bu durum kendiliğinden
       kapanmaz; en eskisi günler öncesi olabilir.
     - **«Geciken iş»:** şimdi, bu nöbet: sunucunun geç dediği el görevleri ve zamanı geçmiş vital ölçümler.
     - **«Sessiz monitör»:** şimdi: sessiz ya da haber alınamayan monitörler («Cihazlar» sayfasının kurallarıyla,
       §3.22) ve «en uzunu {n} dk»; görünümde hiç monitör yoksa 0 ve «Bu görünümde monitör yok». «1 saatten uzun
       sessiz» gibi bir eşik yok: kaynağı yok.
     - Kapsamı kısıtlı olduğu bilinen bir kullanıcıda (aşağıda, «Birimler») son üç kart yalnız onun kapsamına
       gönderilenleri sayar ve bunu «yalnız kapsamınızdakiler, hastanenin tamamı değil» diye söyler. Kapsam okunamadıysa
       aynı yerde «kapsamınız okunamadı: hastanenin tamamı olmayabilir» yazar; kapsam henüz okunurken ve kısıtsız bir
       kapsamda bir şey yazmaz. İlk kart hep hastane genelidir: sunucu alarm kalitesini kısıtlı bir kapsama vermez.
  3. **«Alarm kalitesi»:** dönem seçici «Bugün» · «7 gün» · «30 gün» (açılışta 7 gün); bu kutuyu ve ilk kartı
     değiştirir. «Bugün» takvim günü değil, son 24 saattir; kutu ve kart bunu «son 24 saat» diye yazar. Hastane
     geneli, denetim kaydından; birim birim değil (denetim kaydındaki alarmın yatağı yok; birim birim alarm kalitesi
     sonraki bir dilimdir). Sayılar: alarm olayı; yanıtlanan ve oranı (tam yüzde: «%100» yalnız yerleşen her olay
     yanıtlandıysa, «%0» yalnız hiçbiri yanıtlanmadıysa yazılır, §3.25; hiçbir olay yerleşmediyse «henüz yerleşen
     yok»); yanıt süresinin ortancası ve p90'ı; eskale edilen; yanıtsız kalan; bekleyen (10 dakikası dolmamış).
     «Günlük alarm sayısı»: her gün için bir çubuk ve sayısı; günler UTC takvimine göredir; «geçen haftaya göre»
     eğilimi yok. Altında türe göre küçük bir tablo. Sunucunun okuma sınırı aşılırsa kutu bunu ve sayılan dönemin
     başını söyler. Kutu yalnız sayfa açılınca ve dönem değişince okunur; kendiliğinden ya da «Yenile» ile
     yenilenmez (sunucu dönemin her olayını denetim kaydından yeniden kurar); kendi okuma saatini altında yazar.
     Okunamazsa kutu nedenini söyler ve içinde bir «Yeniden dene» düğmesi çıkar (kullanıcının eylemi; zamanlayıcı
     yok). Prototipteki «3 dk içinde yanıt» ve «Hatalı olarak işaretlenen» yok: kaynakları yok. Kutu, denetim kaydı
     yetkisi (`audit.view`) ve bütün hastaneyi kapsayan bir kapsam ister; yoksa bunu söyler ve dönem seçiciyi
     göstermez (başka bir dönem de aynı biçimde reddedilir).
  4. **«Birimler»:** yapıdaki her birim için bir satır, şimdi: doluluk («{dolu} / {kullanılabilir} dolu»; sıfırdan
     büyükse rezerve, kullanım dışı ve bakımdaki yataklar, Doluluk ekranının sözcükleriyle), yanıt bekleyen alarm
     (zilin saydığı alarmlar, onaylanan ve ertelenen sayılmaz; kritik ve yüksek ayraç içinde), geciken iş, karşı
     imzası bekleyen devir (en eskisinin yaşıyla), sessiz monitör. Kapalı bir birim «kapalı» diye yazılır. Yatağı
     olmayan ya da yapıda bulunmayan bir birimdeki hasta ve monitörler en alttaki **«Birimi belli olmayan»**
     satırında toplanır; sayacak bir şey yoksa bu satır yazılmaz. Yapı okunurken tablonun yerinde «Birimler
     okunuyor…» yazar; hiç okunamadıysa ya da okuma yetkisi yoksa (sunucu reddettiyse de) «Birim satırları
     yazılamıyor · {neden}». Yapının son okuması başarısızsa satırlar son okunan yapıdan yazılır ve doluluk
     «— okunamadı» der.
     - **Kapsamı kısıtlı bir kullanıcı** (ör. `summary.view` verilmiş, birim atanmış bir başhekim): sunucu panoyu,
       görevleri, bekleyen devirleri ve cihaz panosunu onun kapsamıyla keser. Bu yüzden birim ataması olmayan bir
       birimin satırı bu dört sütunda sayı yerine «— yetki yok» der, asla 0 değil; birimden yalnız bir yatak atanmışsa
       da öyle (birimin bütünü onun değildir). Doluluk, yapıyı yönetme yetkisi (`structure.manage`) varsa yine yazılır
       (o zaman sunucu yapının tamamını verir); yoksa o da «— yetki yok», çünkü yapı yalnız onun yataklarını listeler.
       Kapsam, kullanıcının kendi kapsam okumasıdır (`GET /scope/me`; her oturum açmış kullanıcı okuyabilir ve pano
       ile aynı kuralla kurulur), sayfanın kendi okumalarıyla birlikte okunur. O yanıt vermeden ya da okunamadıysa
       geciken iş, bekleyen devir, sessiz monitör ve (yapıyı yönetme yetkisi yoksa) doluluk hücreleri kapsam
       okumasının kendi nedeniyle «—» der («okunuyor…», «okunamadı»). Yanıt bekleyen alarm sütunu ise panonun kendi
       kapsamına bakar (sayıları da kapsamı da aynı yanıttan gelir): panoyu görme yetkisi (`board.view`) olmayan bir
       grupta yalnız bu sütun «— yetki yok» der, görevler ve devirler gerçek sayılarıyla yazılır; pano okunamazsa da
       yalnız bu sütun nedenini söyler. «Birimi belli olmayan» satırı yalnız kısıtsız olduğu bilinen bir kapsamda
       yazılır.
- **Her sayı ya gerçektir ya da neden yok olduğunu söyler.** Henüz okunmamış, okunamamış, güncel olmayan ya da
  yetkiniz olmayan bir kaynak, kendi sütununda ya da kartında «—» ve kısa nedeniyle yazılır: «okunuyor…»,
  «okunamadı», «pano güncel değil», «yetki yok», «veri zinciri kesik», «bilinmiyor», «monitör şeridi kapalı»,
  «monitör verisi güncel değil». Asla 0 yazılmaz. Sıfırı yalnız güncel bir yanıt söyler (Karar 18): yanıt bekleyen
  alarm sütunu yalnız pano canlıyken (bağlantı kopmuş sayılırken «pano güncel değil»), sessiz monitör sütunu yalnız
  cihaz panosu güncelken sayar (değilse «monitör verisi güncel değil»). Okuması başarısız olan bir kaynağın son
  sayısı da bugünün sayısı gibi gösterilmez. Biçimi beklenmeyen bir yanıt (tek bir bozuk kayıt bile) okunamamış
  sayılır: bozuk kaydı atlayıp birimine 0 yazmak da uydurmak olurdu.
- **Ne zaman okunur:** canlı pano ve cihaz panosu uygulamanın kendi sürekli okumalarıdır, sayfa onlara bakar. Yapı,
  görevler, bekleyen devirler ve kullanıcının kendi kapsamı sayfa açılınca, «Yenile»de, sayfa görünürken her 60
  saniyede bir ve sayfa yeniden görünür olunca hemen okunur.
- **Sunucuda iki küçük değişiklik:**
  - yeni `GET /handovers/pending` (`summary.view`): birim başına karşı imza bekleyen devir sayısı ve en eskisinin imza
    zamanı; yalnız sayılar ve zamanlar (hasta, not ya da kişi yok); çağıranın kurumu ve birimleriyle sınırlı;
  - `GET /tasks` her hastanın birimini ve yatak anahtarını artık kartın kendi yerinden okuyor (önceden hep boştu; bir
    düzeltme).
- **Bu dilimde olmayanlar:** birim birim alarm kalitesi; «Rapor al» ya da dışa aktarma; «Günlük özet hazır»
  bildirimi; geçmiş (sistem yeniden başlamadan önceki cihaz sessizliği, geçmiş vital ölçüm gecikmeleri); prototipin
  kaynaksız sayıları; sorumlu hemşire, denetçi ya da başhekim için varsayılan erişim (göç ister); «Kalite
  göstergeleri» ekranı.
- **Kaynak:** `docs/superpowers/specs/2026-11-11-g4-yonetici-ozeti-design.md`; plan
  `docs/superpowers/plans/2026-11-11-g4-yonetici-ozeti.md`.

### 3.25 «Kalite göstergeleri»: birim birim bakım süreci (Grup 4 · G4-03)

- **Ne:** Sol raydaki **«Kalite göstergeleri»** sayfası (`/kalite`; Azerbaycanca «Keyfiyyət göstəriciləri», Rusça
  «Показатели качества», İngilizce «Quality indicators»; telefonun dar rayında «Kalite»). Birim birim bakım süreci,
  son 24 saat, 7 ya da 30 gün için, yalnız sistemin gerçekten kaydettiğinden: alarm yanıtı, erteleme, RRT çağrısı ve
  devrin karşı imzası. «Süreç ölçülür, kişi değil»: sayfa yalnız okur; hiçbir yerde hasta adı, kimliği ya da bir
  kişinin adı yoktur. Örneklerdeki sayılar uydurmadır.
- **Durum:** kodda (`feat/g4-kalite`); main'e ve hastane sunucusuna sahibin sözüyle çıkar. Sunucuda göç `0020`
  çalışmalıdır.
- **Kim görür:** yeni yetki `quality.view` («Kalite göstergelerini görür») olan. Varsayılan **«Denetçi»** grubu taşır
  (göç `0020` var olan hastanelere verir; sonra kurulan bir hastanenin Denetçi grubu kendiliğinden taşır); Sistem
  Yöneticisi her yetkiyi kural gereği taşır. Başka bir gruba (ör. hastanenin kendi «Kalite birimi») Yönetim › Roller ve
  yetkiler'den kodsuz verilebilir. Bir çalışma ekranıdır: yalnız bu yetkiyi taşıyan bir hesap bununla oturum açar ve
  girişte bu sayfaya düşer. Rayda «Yönetici özeti»nden sonra gelir; kimsenin giriş sayfası değişmedi (Denetçi ve
  Sistem Yöneticisi yine «Yataklar»a düşer). Denetçi grubunun açıklaması («Salt okunur: pano ve denetim kaydı.»)
  değişmedi.
- **Kapsam:** birim atanmış bir kullanıcı (Yönetim › Kullanıcılar) yalnız **birim** atamalarının birimlerini görür;
  bir yatak ataması o yatağın birimini kapsamaz. Ona «Birimi belli olmayan» satırı yazılmaz; kartlar ve «Toplam»
  yalnız onun birimlerini toplar ve kartların başlığı «Kapsamınızdaki birimler · {dönem}» olur. Kapsamındaki her açık
  birim, dönemde hiçbir şey olmasa da sıfırlarıyla yazılır. Kapsamında hiç birim yoksa (ör. yalnız bir yatak
  ataması) tablonun yerinde bir kez «Kapsamınızda birim yok.» yazar; kapsam satırı, «Erteleme nedenleri» ve «Türe göre
  alarmlar» o zaman çizilmez, kartlar yanıtın kendi sıfırlarını gösterir. Ataması olmayan bir hesap (ör. birim
  atanmamış bir Denetçi) bugün kısıtsızdır ve bütün birimleri görür (§3.5, «Birimler»); sunucu ataması olmayanları
  kısıtlayacak biçimde ayarlanırsa (`SCOPE_ENFORCE_UNASSIGNED`) yönetici olmayan böyle bir hesap «Kapsamınızda birim
  yok.» okur.
- **Sayfanın sırası (yukarıdan aşağı):**
  1. **Başlık:** «Kalite göstergeleri», «Süreç ölçülür, kişi değil», yanıtın sunucuda üretildiği an («10:42
     itibarıyla»; henüz yanıt yoksa «Henüz okunmadı»), dönem seçici «Bugün» · «7 gün» · «30 gün» (açılışta 7 gün;
     «Bugün» takvim günü değil, son 24 saattir ve kartlar bunu «son 24 saat» diye yazar) ve «Yenile». Altında
     sayfanın ne olduğunu söyleyen kısa bir paragraf.
  2. **Kapsam satırı:** «Bu dönemde 9 alarm olayından 7 tanesi bir birime bağlanabildi. Birime bağlanamayanlar: bu
     sistemde kabul kaydı olmayan (HBYS'den gelen ya da kimliği olmayan monitör) hastalar.» Kapsamı kısıtlı bir
     kullanıcıda: «Yalnız kapsamınızdaki birimler: bu dönemde bu birimlere 7 alarm olayı bağlandı.» Dönemde hiç alarm
     olayı yoksa satır bunu düz söyler: «Bu dönemde alarm olayı yok.» (kısıtlı kapsamda «Yalnız kapsamınızdaki
     birimler: bu dönemde bu birimlerde alarm olayı yok.»); «0 alarm olayından 0 tanesi» yazılmaz. Sunucunun okuma
     sınırı aşıldıysa altında bir not alarm, erteleme ve RRT sayılarının hangi andan (gün, ay, saat) başladığını
     söyler; devirler yine dönemin tamamından sayılır.
  3. **Kartlar («Hastane geneli · son 7 gün»; kısıtlı kapsamda «Kapsamınızdaki birimler · son 7 gün»):** «Alarm yanıt
     süresi (ortanca)»; «Yanıtlanan alarm» («%82» ve altında «yerleşen 11 alarm olayından 9 tanesi»); «Eskale edilen
     alarm»; «Yanıtsız kalan alarm» (altında «1 tanesi kendiliğinden düzeldi»); «Ertelenen alarm» (altında «1 yüksek
     · 1 orta»); «RRT çağrısı»; «Devir karşı imza süresi (ortanca)». Alt satırlar yalnız kendi sayıları sıfırdan
     büyükken yazılır. Oran tam yüzdedir ve kenarlarında abartmaz: «%100» yalnız yerleşen her olay yanıtlandıysa,
     «%0» yalnız hiçbiri yanıtlanmadıysa yazılır; yerleşen 300 olaydan 299 tanesi yanıtlandıysa «%99», 1 tanesi
     yanıtlandıysa «%1» (düz yuvarlama «%100» ve «%0» derdi). Aynı kural tablodaki «Yanıtlanan» sütununda ve «Yönetici
     özeti»nin «Alarm kalitesi» kutusunda da geçerlidir. Henüz bir yanıt yokken (okunurken, okunamadığında) başlık
     kimin toplamı olduğunu söylemez: «Göstergeler · son 7 gün».
  4. **«Birimlere göre»:** kapsamdaki her açık birim için bir satır, ada göre; dönemde hiçbir şeyi olmayan birim de
     yazılır, gerçek sıfırlarıyla (sayıları 0, oranı «— henüz yerleşen yok», süreleri «—»). Sonradan kapatılmış bir
     birim yalnız dönemde sayacak bir şeyi varsa, adıyla yazılır. Sonra **«Birimi belli olmayan»** (yalnız kısıtsız
     kapsamda; sayacak bir şey olmasa da sıfırlarıyla), sonra **«Toplam»**. Sütunlar: «Birim» · «Alarm» · «Yanıt
     ortancası» · «Yanıt p90» · «Yanıtlanan» · «Eskale» · «Yanıtsız (kendiliğinden düzelen)» · «Ertele» · «RRT
     çağrısı» · «Devir (açılan / karşı imzalı / bekleyen)» · «Karşı imza ortancası». «Birimi belli olmayan»ın iki
     devir hücresinde «—» yazar: her devrin birimi bellidir. Bir satırın adına dokunmak onu seçer (sayfa değişmez);
     «Birimi belli olmayan» ve «Toplam» da seçilir. Açılışta «Toplam» seçilidir; yeni bir okumada seçilen satır yoksa
     seçim «Toplam»a döner.
  5. **«Erteleme nedenleri»:** beş neden, alarm ekranının «Ertele» penceresindeki sözcüklerle (§3.21: «Klinik karar
     verildi», «Artefakt ya da sinyal gürültüsü», «İşlem sürüyor», «Hastanın kendi normali», «Diğer») × sayı; sonra
     «Toplam» ve «Ortanca süre» («12,5 dk»). İlk sütun «Hastane geneli»dir (kısıtlı kapsamda «Kapsamınızdaki
     birimler»); «Toplam»dan başka bir satır seçiliyse yanında onun sütunu durur. Dönemde hiç erteleme yoksa yalnız
     «Bu dönemde erteleme yok.» yazar.
  6. **«Türe göre alarmlar · {seçim}»:** seçilen satırın (açılışta «Hastane geneli») alarm türleri, motorun kendi tür
     adlarıyla (ör. `news2`): «Olay», «Yanıtlanan», «Eskale», «Yanıtsız», «Ortanca yanıt». Seçimde hiç olay yoksa
     «Bu seçimde alarm olayı yok.»
- **Bir alarm bir birime nasıl bağlanır:** denetim kaydındaki alarm satırında yatak ya da birim yoktur, yalnız
  hastanın kartının anahtarı vardır. Sunucu yolu şöyle kurar: kartın anahtarı → bu sistemde açılmış kabul → kabulün
  yatağı → o yatağın birimi. Kartın anahtarı 0015'ten beri kabulün protokol numarasıdır (§3.10); protokol numarası
  olmayan daha eski bir kabulde hastanın H-numarasıdır. Kabul taburcu edilmiş olsa da sayılır (geçmiş bir alarmın
  hastası çoğu zaman taburcu edilmiştir). Kabulün yatağı, dolayısıyla birimi, sonradan değişmez (nakiller kapalı); bu
  yüzden bağlama dönemin her anı için aynıdır. **Bağlanamayanlar:** HBYS'den gelen hastalar ve kimliği olmayan
  monitörler (bu sistemde kabulleri yoktur, geçmiş konumları da tutulmaz) ile iki ayrı birimde kabulü olan eski
  (H-numaralı) bir anahtar. Bunlar «Birimi belli olmayan» satırında toplanır; kapsam satırı kaçının bağlanabildiğini
  söyler. Ertelemeler ve RRT çağrıları aynı yolla bağlanır; her devrin birimi zaten bellidir (hastanın yatağının
  birimi, §3.18).
- **Sayılar nasıl sayılır:**
  - **Alarmlar** «Alarm kalitesi» kutusunun kurallarıyla (§3.24): alarm olayı; yanıtlanan; yanıtsız kalan (hiç
    yanıtlanmamış ve en az 10 dakikalık); 10 dakikası dolmamış bekleyen. «Alarm» sütunu bekleyenleri de sayar, ama
    sayfa onları ayrıca yazmaz ve orana katmaz: oran yerleşen (yanıtlanan ya da yanıtsız kalan) olaylar üzerindendir.
    Yanıt süresinin ortancası ve p90'ı (en yakın sıra).
  - **«Kendiliğinden düzelen»** (kartta «{n} tanesi kendiliğinden düzeldi», tabloda «Yanıtsız» sütununda ayraç
    içinde): yanıtsız kalanlardan, kuralı kendiliğinden durmuş olanlar, yani motorun kuralı artık tetiklenmediği için
    kapattığı alarmlar. Kimsenin onaylamadığı ve «geçti · onaylanmadı» durumunda kalan kritik alarm da sayılır: kuralı
    durmuştur. Yalnız taburcu ile ya da ölçümün «hatalı giriş» olarak işaretlenmesiyle (§3.12) kapanan alarm
    sayılmaz: orada hasta ayrılmış ya da değer geri çekilmiştir, alarm kendiliğinden düzelmemiştir. Bu sınır sahibin
    kararıdır (2026-11-11, «Yalnız kural durduysa»).
  - **Hastane geneli** (kartlar ve «Toplam»): ortanca ve p90 bütün olaylar üzerinden hesaplanır (kısıtsız kapsamda
    «Birimi belli olmayan»ınkiler dahil); birim ortancalarının ortalaması değildir.
  - **Ertelemeler:** sayı; nedene ve önem derecesine göre (yalnız yüksek ve orta ertelenebilir, §3.21); ortanca
    erteleme süresi (verilen dakika). Ertelemenin açıklama metni okunmaz.
  - **RRT çağrıları:** yalnız sayı; çağrının serbest metin nedeni sunucudan çıkmaz.
  - **Devirler:** dönem içinde açılanlar («açılan»); karşı imzalananlar («karşı imzalı»); devredenin imzaladığı,
    devralanın henüz karşı imzalamadığı devirler («bekleyen»). Karşı imza süresi, devredenin imzasından karşı imzaya
    kadardır; sayfa karşı imzalananların ortancasını yazar. **«30 dakika içinde karşı imza» payı yoktur:** karşı
    imzanın sistemde bir süresi yoktur (30 dakika, açık bir devrin devredenin imzasını beklediği süredir, §3.18); bu
    yüzden sayfa bir pay değil, süreyi gösterir.
- **Her sayı ya gerçektir ya da neden yok olduğunu söyler.** Sayfa okunurken, okunamadığında ya da sunucu okumayı
  reddettiğinde (ör. yetki oturum açıkken geri alındı) her kart «—» ve kısa nedeniyle yazılır («okunuyor…»,
  «okunamadı», «yetki yok»); asla 0 yazılmaz. Tablonun yerinde okunurken «Kalite göstergeleri okunuyor…», sonra
  «Tablo yazılamıyor · okunamadı» (ya da «· yetki yok») yazar; kapsam satırı, «Erteleme nedenleri» ve «Türe göre
  alarmlar» o zaman çizilmez. Okuma başarısızsa (ret dışında) başlığın altında bir uyarı «Kalite göstergeleri
  okunamadı: {neden}» der; yeniden denemek «Yenile»dir (ikinci bir düğme yok). Başarısız bir okuma önceki yanıttan
  hiçbir şey bırakmaz: kartlar «— okunamadı» der, birim satırı yazılmaz. Biçimi beklenmeyen bir yanıt (tek bir bozuk
  sayı bile; ya da istenen dönemin değil başka bir dönemin yanıtı) okunamamış sayılır: «Kalite göstergeleri
  okunamadı.» Yerleşen hiçbir olayın olmadığı bir oran «— henüz yerleşen yok»; üzerinde hiçbir şey olmayan bir
  ortanca hücrede «—», kartta «— yanıtlanan yok» ya da «— karşı imzalanan yok» olarak yazılır.
- **Ne zaman okunur:** sayfa açılınca, dönem değişince ve «Yenile»de; zamanlayıcı yoktur (sunucu dönemin her olayını
  denetim kaydından yeniden kurar). En yeni okuma kazanır: dönem art arda değiştirilirse yalnız son seçilen dönemin
  yanıtı yazılır. «Yenile» aynı dönemi yeniden okur; okuma sürerken kartlar «— okunuyor…» der. Dönem değişince de
  öyle: yeni dönemin yanıtı gelene kadar eski dönemin sayıları gösterilmez.
- **Sunucuda:**
  - yeni `GET /quality?days=1|7|30` (`quality.view`; başka bir değer 422): birim başına sayılar ve süreler, birimin
    kimliği ve adıyla; kapsamdaki her açık birim, sessiz olsa da sıfırlarıyla (kısıtlı bir kullanıcıda boş bir birim
    listesi kapsamın boş olduğu demektir); yalnız çağıranın kurumu ve birim atamaları (bir yatak ataması bir birimi
    kapsamaz); hasta anahtarı, kişi ya da serbest metin yok. Kullanıcının kapsamı o an okunamazsa yanıt boş bir kapsam
    değil, 503'tür («kapsam şu anda okunamıyor»): sayfa «Kalite göstergeleri okunamadı: …» yazar. Denetim kaydının
    dönemdeki en yeni 20 000 satırını okur (alarm olayları, ertelemeler ve RRT çağrıları bu sınırı paylaşır);
    devirleri kendi tablosundan, dönemin tamamından okur. Yanıt, sayfanın bu sürümde yazmadığı iki sayıyı da taşır:
    süresi dolan devirler (30 dakikalık süresi devredenin imzası olmadan dolan) ve karşı imza süresinin p90'ı;
  - `GET /alarm-quality` yanıtına yeni bir alan, `unanswered_resolved` (kendiliğinden düzelen yanıtsız alarmlar);
    `repeats` alanı kalktı, üst düzeyde ve türe göre dökümde (`per_kind`); `/quality` onu hiç göndermedi (iki yol
    da artık denetim kaydının `alert` satırlarını okumuyor; hiçbir sayfa onu yazmıyordu); başka bir alan değişmedi;
  - göç `0020`: her hastanenin Denetçi grubuna `quality.view` (0019'dan sonra gelir; yalnız yetki satırı yazar, tablo
    ya da sütun eklemez);
  - nginx ve geliştirme sunucusu `/quality`'yi API'ye iletir.
- **Bu dilimde olmayanlar:** el görevlerinin zamanında yapılması, vital ölçüm sıklığı ve geçmiş vital ölçüm
  gecikmeleri; prototipin kaynaksız sayıları («3 dk içinde yanıtlanan», «Hatalı / artefakt olarak kapatılan»,
  «Güvenlik olayları», «İncelenecek olaylar», cihaz kesintisi); «Rapor al» ya da dışa aktarma; HBYS'den gelen
  hastaların birime bağlanması (konum geçmişi ister); nakiller (açılırsa anahtar → birim eşlemesi zamana bağlı
  olmalı: her kabulün her birimdeki başlangıcı ve sonu).
- **Açık:** Azerbaycanca, Rusça ve İngilizce metinler yerel okuma bekliyor.
- **Kaynak:** `docs/superpowers/specs/2026-11-11-g4-kalite-gostergeleri-design.md`; plan
  `docs/superpowers/plans/2026-11-11-g4-kalite-gostergeleri.md`.

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
    çizgili bir şeritte görünür. Aşama A'da yalnız görüntüdür: alarm, skor, bildirim, ses
    üretmez; motor bu değerleri hiç görmez (kabulde pano özeti değişmedi, denetim kaydına 0 satır
    düştü). Aşama B açılırsa (aşağıdaki «Gölge öneri» maddesi) bu değerlerden *gölge* bir skor
    (NEWS2 dahil) hesaplanır — alarm kapalı, yalnız tavsiye; gerçek motor yine hiçbir şey
    görmez. Bütün
    klinisyenler görür; biyomedikal ayrıca "Monitörler" ekranında cihazları hasta bilgisi olmadan
    görür. Kapatma üç kademe: **G-1** forwarder kapalı (hub'da drop-in 93 silinir; saniyeler
    sürer; şerit "Monitör verisi gelmiyor" der), **G-2** aşama kapalı (API `.env`'de
    `INFINITY_CLINICAL_STAGE=off`; şerit tamamen kalkar), **G-3/G-4** kod geri. Cihaz→yatak
    tablosu (`deploy/local/infinity-shadow/device-beds.json`, sürüm 1, sha `ac5ce1c9549c`)
    19.10'da proje sahibince merkezi monitörün yatak listesinden onaylandı; değişiklik yeni bir
    sürüm olarak aynı yolla onaylanır. Ayrıntı ve kabul ölçümleri: `deploy/infinity/README.md`,
    "Aşama A" bölümü. (Monitör–yatak eşleme dilimi sunucuya dağıtılınca tablo veritabanına taşınır
    ve «Monitörler» ekranından değiştirilir; dosya tarihçe olarak kalır — 3.9.)
  - **Şeritte NBP (NBP dilimi):** cihaz NBP'nin ne zaman ölçüldüğünü pakette söylemiyor (son
    değeri her pakette yineliyor), bu yüzden şerit NBP'yi **değerinin son değiştiği saatle**
    gösterir: "NBP 118/79 (92) mmHg · ölçüm ≤ 10:42 (12 dk)". "≤" bir **üst sınırdır**: manşon en
    geç o saatte ölçmüştür, daha önce ölçmüş olabilir. Değişiklik ancak bir önceki tam ve geçerli
    NBP üçlüsü en çok 3 saniye önce geldiyse saat alır (`***` ya da eksik paketler sayılmaz);
    saat, hub saatine göre, gerçeğinden en çok 3 saniye yeni olur (işçi ile API arasındaki en çok
    2 sn'lik saat kayması şeritteki her yaş için aynıdır). Hub yeniden başladıktan sonra, ya da
    değer bir kesinti ya da tam üçlüler arasında 3 saniyeden uzun bir boşluk sırasında değiştiyse,
    NBP'nin saati bilinmez: R4'te değeri değiştiren bir sonraki ölçüme kadar "— ölçüm bekleniyor"
    yazardı; NBP-2 (R5) ile değer «ölçüm zamanı bilinmiyor» notuyla gösterilir (bir sonraki madde).
    Aynı değer geri gelirse eski saatiyle hemen görünür. Saati bilinen ve değeri 2 saatten uzun
    süredir değişmemiş NBP gösterilmez ("— eski · 3 sa"; API 2 saatten 15 sn önce keser ki hiçbir
    ekranda 2 saati geçmesin). Aynı
    değerle yinelenen ölçüm fark edilmez (saat gerçeğinden eski kalır, yeni değil). Hub sürümü R4,
    drop-in 94; geri alma: önce 94 silinir (hub R3'e, NBP'siz şeride döner), API/web ancak ondan
    sonra. Dağıtımda sıra tersidir: önce API ve web, sonra hub.
  - **Şeritte zamanı bilinmeyen NBP (NBP-2, 28.10 kararı «son değeri göstersin»):** hub açıldığından
    beri değeri değişmemiş bir NBP'nin saati bilinmez; şerit onu artık gizlemez, monitörün o an
    gösterdiği değeri **«ölçüm zamanı bilinmiyor»** notuyla gösterir: "NBP 118/79 (92) mmHg · ölçüm
    zamanı bilinmiyor". Not dikkat renginde, "≤" ve ölçüm yaşı yok: değer monitörün gösterdiğidir,
    ne zaman ölçüldüğü bilinmez. İlk değişiklik görülünce saatli biçime döner. Yalnız tam ve geçerli
    üçlü gösterilir (`***` ya da eksik parça varsa gösterilmez); paket eskiyince diğer değerler gibi
    gizlenir. Bu değer hiçbir kurala girmez (gölge motor NBP'yi yalnız saatiyle alır). Hub sürümü R5,
    drop-in 95; geri alma: 95 silinir (R4'e, zamansız manşet «ölçüm bekleniyor»a döner). VM'de
    30.10.2026'dan beri çalışıyor.
  - **Gölge öneri · alarm kapalı (Aşama B — hastanede 28.10.2026'dan beri açık, aşama `rules`):**
    Aşama B'de şeritteki değerler yalnız gösterilmekle kalmaz, kuralların girdisi de olur — ama
    gerçek motora değil, ona hiç dokunmayan ikinci bir "gölge" motora. **Gölge öneri**, kuralların
    (NEWS2, sepsis…) monitörün doğrulanmamış değerleriyle söyleyeceği şeydir. Her yatak için,
    parametre başına dakikada bir örnek alınır (her ölçüm değil); yalnız monitörü yatağa bağlı olan
    ve o yatakta tam bir hasta kayıtlı bulunan yataklarda. İki hasta ya da iki monitör varsa hiçbir
    şey yazılmaz.
    - *Ne değildir:* **alarm değildir.** Zil çalmaz, bildirim gitmez, eskalasyon olmaz, Alarmlar
      ekranına girmez, hiçbir alarm sayacına girmez; bu değerler gerçek motorun hiçbir kaydına
      yazılmaz. Başucu monitörü birincil alarmdır — gölge öneri onun yerine geçmez ve ona bakmayı
      bırakmak için gerekçe değildir. Tanı da koymaz: kuralların hangi girdilerle ne söyleyeceğini
      gösterir, kararı klinisyen verir.
    - *Nerede görünür:* (1) Hasta ekranında «Ölçülen değerler» bölümünde, kayıtlı değerlerin
      yanında (yerlerine geçmeden) «monitör · HR», «monitör · PLS», «monitör · SpO₂»,
      «monitör · ART» ya da «monitör · NBP» etiketli, saatli kartlar; ve ekranın aşağısında
      «Gölge öneri · alarm kapalı» kutusu: gölge NEWS2 puanı ve girdileri (eksik ya da varsayılan
      girdi uyarıları gerçek NEWS2'dekiyle aynı biçimde yazılır; gölge puan çoğunlukla kısmidir,
      çünkü solunum ve sıcaklık monitörden okunmaz), gölge bulgular ve her birinin gerçek motorun
      bulgusuyla ilişkisi: «gerçek bulguyla aynı», «yalnız gölgede», «düzey farklı». (2) Yatak
      kartında şeridin altında kehribar bir etiket: gölge bir bulgu varsa «gölge öneri · NEWS2 7 ·
      3 dk önce» (puan ve son girdinin yaşı), yoksa «gölge öneri yok»; pano güncel değilse «gölge
      öneri · bilinmiyor». (3) Ayarlar'da «Uyarsaydı — son 7 gün»: yalnız gölgede açılan bulgular,
      yani monitör girdileri olmasaydı görünmeyecek olanlar; haftalık değerlendirme içindir. Haftada
      kaç tanesinin kabul edilebilir olduğu için kasada bir kaynak yok; bu rakamı klinisyen
      belirleyecek.
    - *Kaynak etiketleri:* **HR** EKG'den nabız; **PLS** SpO₂ probundan nabız (yalnız HR yoksa
      kullanılır); **SpO₂** monitörün SpO₂'si; **ART** arter hattının sistolik ve ortalama basıncı;
      **NBP** manşet basıncı — yalnız arter hattı değeri yoksa ve ölçüm en çok 1 saat önceyse
      kullanılır. Manşetin saati şeritteki gibi «≤» ile verilen bir üst sınırdır ve puan o saate göre
      değerlendirilir. Kart hangi kaynaktan okunduğunu yazar; kaynak değişirse (ör. HR kesilip
      PLS'e geçilirse) etiket de değişir.
    - *HR/PLS düzeltmesi (hub sürümü R6):* 27.10'da, HR ile PLS'in farklı olduğu bir yatakta planlı
      kayıt ve videoyla doğrulandı ki kod iki adı **ters** veriyordu. R6'ya kadar şeritteki «HR»
      aslında SpO₂ nabzı, «PLS» EKG nabzıydı; gölge motor da nabzı önce SpO₂ probundan aldı. Çoğu
      hastada ikisi aynıdır. R6 iki adı yer değiştirir; ondan önceki gölge örnekleri ve bulgular eski
      adlarla kayıtlı kalır.
    - *Bilerek dışarıda:* solunum sayısı (RESP) ve vücut sıcaklığı kurallara girmez — izin listesinde
      kapalıdır (RESP ekrandan doğrulanmadı; sıcaklığın ölçüm yeri belli değil); arter diyastolik
      basınç ve etCO₂ de girmez. Şerit bunları göstermeye devam eder. Dalga formu da kurallara
      girmez (dalga paneli yalnız görüntüdür, 3.11).
    - *Hasta değişince:* yatağın hastası değişirse eski hastanın monitör değerleri yeni hastaya
      yazılmaz (eski hastanın gölge bulguları kapanır, yeni hasta ilk örneğini bir dakika içinde
      alır); monitör taburcu edilmiş bir numaraya bağlıysa hiçbir şey yazılmaz.
    - *Açma ve kapatma:* hastanenin yazılı onayı olmadan sahada açılmaz. Kapatma kademeleri:
      **G-1** forwarder kapalı (örnekleme geçişi hiç çalışmaz, bağlantı da bitmez: açık gölge
      bulgular yaşlarıyla gösterilerek forwarder dönene ya da aşama değişene dek açık kalır);
      **G-2b** API `.env`'de `INFINITY_CLINICAL_STAGE=shadow` (örnekleme durur, açık her gölge
      bulgu kapanır, kutu ve etiketler kalkar, gerçek pano değişmez); **G-2** `off` (şerit de
      kalkar). Ayrıntı: `deploy/infinity/README.md`, "Aşama B" bölümü; tasarım:
      `docs/superpowers/specs/2026-10-27-infinity-asama-b-golge-motor-design.md`.
  - **Dalga paneli (dalga dilimi · doğrulanmamış, yalnız görüntü):** monitörün yayınındaki dalga
    blokları da çözüldü. EKG, basınç (ART ya da P1), pleth ve solunum, şeridin altında monitörün
    yaklaşık 2 saniye gerisinden kayan bir panelde çizilir: hasta ekranında yalnız şeridin tek bir
    monitöre bağladığı hastada, «Monitörler»de «Dalga formunu göster» düğmesiyle. Ses, sayı ya da
    alarm üretmez, hiçbir şey saklamaz; varsayılan olarak kapalıdır (`INFINITY_WAVES=on`). Henüz
    hastanenin sunucusunda yok. Ayrıntı: 3.11; protokol: `docs/INFINITY-DALGA-FORMU.md`.
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
