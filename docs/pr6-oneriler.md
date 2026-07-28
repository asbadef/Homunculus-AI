# Homunculus ICU-IS — 20 Öneri: Rol Dağılımı, Süreç Kurgusu ve İzlenebilirlik

> Bu belge PR#6 kapsamında hazırlanmıştır. Sistem bir **klinik izleme ve karar-destek** platformudur; **teşhis koymaz** — makine tarafından üretilen alarm metni her zaman "…kriterleri değerlendirilecek" biçimindedir. Nihai klinik karar her zaman hekime aittir. Tüm demo verileri **sentetiktir** ve kimlik numaraları maskelenir (KVKK / T.C. Sağlık Bakanlığı mevzuatı).

## Rol modeli (özet)

| Rol | Kod | Temel yetki | Alarm eskalasyon konumu |
|-----|-----|-------------|--------------------------|
| Sorumlu/Nöbetçi Hekim | `ATTENDING` | Klinik veri girişi, tanı (ICD-10), ilaç/infüzyon, eşik ayarı, epikriz | 2. kademe (3–5 dk) |
| Sorumlu Hemşire | `CHARGE_NURSE` | Vital takip, alarm onayı, sıvı dengesi, devir-teslim | 1. kademe (0–3 dk) |
| Hızlı Yanıt Ekibi | `RRT` | Kritik eskalasyon müdahalesi, break-glass erişim | 3. kademe (5–10 dk) |
| Hastane Yöneticisi | `HOSPITAL_ADMIN` | Kullanıcı/yatak/ünite yönetimi, denetim kaydı, raporlama | İzleyici (operasyonel) |

Eskalasyon zinciri (S-05): **0–3 dk** Hasta Başı + Banko TV → **3–5 dk** Nöbetçi Hekim + Sorumlu Hemşire (PWA push) → **5–10 dk** Sorumlu Hekim + RRT. Kritik (CRITICAL) alarmlar ertelenemez; yalnızca gerekçeli onay veya eskalasyon ile kapatılır.

---

## A. Frontend (Klinik Kullanıcı Deneyimi) — 5 öneri

**F1. Hasta başı "tek ekran" modu (kiosk/duvar paneli).**
Duvara asılan büyük ekranlar için, seçili ünitenin tüm yataklarını NEWS2 + kritik vital + açık alarm sayısı ile gösteren tam ekran, dokunmasız bir görünüm. YB-Yüksek-Kontrast teması bu mod için varsayılan olmalı; 3 metre mesafeden okunabilir tipografi. *(PR#6'da NEWS2 rozeti ve yüksek kontrast teması altyapısı hazır.)*

**F2. Mini vital trend grafiklerinin genişletilmesi (drill-down).**
Hasta detayındaki SpO₂/HR/MAP sparkline'larına tıklanınca 6–24 saatlik tam ekran grafik, alarm eşik çizgileri (kırmızı/sarı bant) ve alarm tetiklenme işaretleri (annotation) gösterilmeli. Hekim, kötüleşmenin zaman içindeki seyrini görsel olarak izleyebilmeli.

**F3. Akıllı bildirim merkezi ve "benim hastalarım" filtresi.**
Kullanıcı, bakım ekibinde atandığı hastaları tek tıkla filtreleyebilmeli; üst çubukta okunmamış alarm/eskalasyon rozeti olmalı. Nöbet değişiminde "devralınacak açık işler" özeti (onaylanmamış alarm, imzalanmamış devir) gösterilmeli.

**F4. Hızlı klinik eylem çubuğu (order set / paket girişler).**
Sık kullanılan tanı + ilaç + prosedür kombinasyonları için tek tıkla uygulanabilir şablonlar (ör. "Sepsis paketi": kan kültürü + geniş spektrum antibiyotik + sıvı resüsitasyonu prosedürleri). Hekimin girişte harcadığı süreyi azaltır; her adım yine zaman damgalı ve audit'e yazılır.

**F5. Erişilebilirlik ve çoklu dil tutarlılığı.**
Tüm etkileşimli öğelerde klavye navigasyonu, `aria-label`, renk-körü dostu durum ikonları (renge ek olarak şekil/etiket). ICD-10 kodları, ilaç etken maddeleri ve ölçü birimleri (mcg/kg/dk, mmHg, bpm) hiçbir dilde çevrilmez — bu standart PR#6'da korunmuştur; dört dil (TR/AZ/EN/RU) genelinde terminoloji sözlüğü sürdürülmeli.

---

## B. Backend (Motor, Veri, Güvenlik) — 5 öneri

**B1. Sunucu tarafı erken uyarı skoru motoru (NEWS2/PEWS + eğilim).**
PR#6'daki tarayıcı-içi otomatik alarm motorunun kural seti backend'e taşınmalı; cihaz akışından gelen vitallerle NEWS2 (erişkin) ve PEWS (pediatri/neonat) skorları sunucuda hesaplanmalı. Yalnızca eşik ihlali değil, **eğilim/hız** (ör. son 2 saatte MAP düşüş hızı) de değerlendirilmeli. Karar mantığı sürüm-etiketli ve denetlenebilir olmalı.

**B2. Cihaz entegrasyon katmanı (HL7 v2 / FHIR + gerçek zamanlı akış).**
Monitör, ventilatör ve infüzyon pompalarından veri almak için HL7/FHIR uyumlu bir entegrasyon adaptörü; kesinti/geç-veri durumları için "veri yaşı" (staleness) bayrağı. Veri gelmediğinde alarm "değerlendirilemez" durumuna düşmeli, sessizce yeşil kalmamalı.

**B3. Değiştirilemez (append-only) denetim günlüğü ve olay kaynağı (event sourcing).**
S-15 gereği tüm klinik ve idari eylemler yalnızca-ekleme (immutable) bir günlüğe yazılmalı; hash zinciri ile bütünlük garanti altına alınmalı. PR#6 frontend'de gösterilen audit log'un kaynağı bu olmalı. KVKK/SB denetimlerinde "kim, ne zaman, neyi, hangi gerekçeyle" sorgulanabilir olmalı.

**B4. Rol tabanlı erişim + break-glass ve KVKK veri minimizasyonu.**
Sunucu tarafında satır düzeyinde yetkilendirme (kullanıcı yalnızca yetkili olduğu ünite/hasta verisini görür). Break-glass (acil erişim) gerekçeli, süreli (30 dk) ve otomatik denetim uyarısı üretmeli. İsim maskeleme kararı sunucuda da uygulanmalı; PHI asla loglara/hata izlerine sızmamalı.

**B5. Bildirim/eskalasyon servisi (kuyruk + teslim garantisi).**
Eskalasyon adımlarını (0–3 / 3–5 / 5–10 dk) yürüten, PWA web-push / SMS / DECT telefon entegrasyonlu, teslim onayı (delivery receipt) izleyen bir servis. Bir kademe onaylanmazsa otomatik bir üst kademeye geçmeli; tüm geçişler audit'e yazılmalı. Alarm yorgunluğunu azaltmak için akıllı gruplama ve mute politikası (kısa süreli, eskalasyon saatini sıfırlamadan).

---

## C. Yönetici (Admin) — Rahat İzlenebilir Alanlar — 5 öneri

**C1. Operasyonel komuta panosu (canlı KPI).**
Doluluk oranı, açık/kritik alarm sayısı, ortalama alarm onay süresi (time-to-acknowledge), eskalasyon oranı, aktif break-glass oturumları — hepsi tek ekranda canlı. Ünite bazında ısı haritası; eşik aşımında yönetici uyarısı.

**C2. Denetim kaydı gezgini (Audit Log Explorer).**
PR#6'da eklenen denetim kaydının; kullanıcı, rol, eylem tipi, hasta ve tarih aralığına göre filtrelenebilir, dışa aktarılabilir (CSV/PDF) gelişmiş sürümü. KVKK/SB denetimi için "tek tıkla rapor". İsimler yöneticinin maskeleme tercihine saygı gösterir.

**C3. Alarm kalitesi ve yorgunluk analitiği.**
Alarm hacmi, tekrar eden/gürültülü alarmlar, mute sıklığı, yanıtsız kalan alarmlar ve kademelere göre yanıt süreleri. Amaç: eşikleri veri temelli iyileştirerek "alarm yorgunluğunu" azaltmak. Hekim/ünite bazında karşılaştırmalı görünüm.

**C4. Kullanıcı, rol ve nöbet (shift) yönetimi.**
Kullanıcı oluşturma/pasifleştirme, rol atama, ünite yetkilendirme ve nöbet çizelgesi. Kimin hangi hastadan sorumlu olduğunun (bakım ekibi) ve devir-teslim durumunun net görünürlüğü. Yetki değişiklikleri audit'e yazılır.

**C5. Uyum ve gizlilik gösterge paneli.**
KVKK isim maskeleme kullanımı, break-glass olayları, veri erişim istatistikleri, veri saklama/silme (retention) durumları. Sistem sağlığı (cihaz veri akışı kesintileri, geç veri oranı) da burada izlenmeli — yönetici tek bakışta "uyum + operasyon" durumunu görebilmeli.

---

## D. Süreç Kurgusu ve Rol Dağılımı — 5 öneri

**S1. Kademeli alarm & eskalasyon protokolünün netleştirilmesi (S-05).**
Her alarm kademesinde **kim, hangi kanaldan, ne kadar süre içinde** yanıt vermeli açıkça tanımlı olmalı. 0–3 dk hasta başı/hemşire, 3–5 dk nöbetçi hekim, 5–10 dk sorumlu hekim + RRT. Onaysız kademe otomatik yükseltilir. Kritik alarm ertelenemez; yalnızca gerekçeli onay/eskalasyon. *(PR#6'da görsel zaman çizelgesi ile uygulanmıştır.)*

**S2. Yapılandırılmış devir-teslim (handover) süreci.**
Nöbet/vardiya değişiminde her hasta için imzalı, zaman damgalı devir (SBAR benzeri: Durum-Arkaplan-Değerlendirme-Öneri). Açık alarmlar ve bekleyen işler devralan kişiye zorunlu olarak aktarılır. *(Altyapı mevcut; SBAR şablonu ile zenginleştirilebilir.)*

**S3. Klinik veri girişinde sorumluluk ve doğrulama.**
Tanı (ICD-10), ilaç ve prosedür girişleri yalnızca yetkili hekim tarafından; her kayıt "kim/ne zaman" ile imzalı. Yüksek riskli ilaçlarda çift-onay (hemşire doğrulaması) süreci. Sistem öneri sunabilir ama **onayı hekim verir** — teşhis koymaz.

**S4. Hasta güvenliği eşiklerinin yönetimi.**
Alarm eşikleri hem ünite varsayılanı hem hasta/hekim özelinde ayarlanabilir olmalı; her değişiklik gerekçeli ve audit'li. Eşik değişikliklerinin klinik sonuca etkisi periyodik gözden geçirilmeli (klinik yönetişim komitesi). *(PR#6'da hasta başına eşik modalı eklendi.)*

**S5. Gizlilik-öncelikli operasyon ve olay müdahalesi.**
Varsayılan olarak veri minimizasyonu (isim maskeleme açık), erişim gerekçeli. Break-glass olayları için tanımlı bir gözden geçirme akışı: her acil erişim sonrası otomatik bildirim + yönetici onayı/incelemesi. Veri ihlali/anomali durumunda tanımlı müdahale prosedürü ve KVKK bildirim yükümlülüklerinin takibi.

---

### PR#6'da hayata geçirilenler (öneri → uygulama eşlemesi)

- **F1/F2/S4** → NEWS2 rozetleri, mini vital trend grafikleri, hasta başına alarm eşik modalı, YB-Yüksek-Kontrast teması.
- **S1** → Otomatik alarm motoru (NEWS2 ≥ 7 / vital sınır ihlali → CRITICAL/HIGH) + görsel eskalasyon zaman çizelgesi + Sessize Al (mute).
- **S3** → Hekim klinik veri girişi modülü: ICD-10 oto-tamamlama, ilaç/infüzyon (etken madde + doz + birim), zaman damgalı prosedürler, sıvı dengesi (I/O).
- **C2** → Denetim kaydı (audit log) görüntüleyici (yönetici panelinde).
- **F5/S5** → KVKK isim maskeleme toggle'ı, Çerez/Aydınlatma banner'ı, dört dilde tutarlı terminoloji (kodlar/etken maddeler/birimler çevrilmez).
- **Tek tıkla epikriz/devir raporu** → yazdırılabilir/PDF çıktı (S2/S3 destekler).

Geri kalan öneriler (B1–B5, C1/C3/C4/C5) çoğunlukla **backend** ve **yönetim analitiği** gerektirdiğinden, sonraki PR'larda `homunculus-engine` tarafında ele alınması önerilir.
