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
hastayı saat saat kötüleştirip doğru uyarıyı doğru anda ürettiğini kanıtlıyor. Ama henüz
**gözü yok** (ekran/panel) ve **gerçek cihaza bağlı değil**. "İstediğin aşama" — doktorun
ekranda canlı görüp bildirim aldığı hâl — 3. basamak.

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
