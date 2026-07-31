# Homunculus AI — Gelecek Yol Haritası (20 Madde)

> Bu doküman, Faz A–E tamamlandıktan sonra sistemi bir **yoğun bakım yönetim platformuna** dönüştürecek yeni modülleri ve iyileştirmeleri önerir. Faz A–D üretildi, Faz E başlatıldı. Aşağıdaki 20 madde bir sonraki büyük dalganın (Faz F ve ötesi) adayıdır.
>
> **Altın kurallar korunur:** (1) sistem asla teşhis koymaz — uyarı metinleri daima "…kriterleri değerlendirilecek" biçimindedir; (2) tüm PHI sentetik ve maskelidir. Klinik terimler (NEWS2, SOFA, qSOFA, MAP, SpO₂, RASS, CAM-ICU, mcg/kg/dk, mmHg) çevrilmez.

---

## Bölüm 0 — Mevcut Durumun Kısa Değerlendirmesi

**Elimizde ne var (Faz A–D):**
- Kimlik/rol/MFA, tenant hiyerarşisi (Tenant→Site→Unit→Room→Bed), 8 branş klinik profili, tam ekran hasta kokpiti, çoklu-parametre trend, sıvı/ilaç zaman çizelgesi.
- Taburcu/transfer iş akışları, RRT eskalasyon, bildirim merkezi, denetim gezgini, PHI maskeleme, arşiv ve oturum kontrolü.
- **Alarm motoru:** 3 kademeli eskalasyon (`TIER_1_CHARGE_NURSE`=180 sn → `TIER_2_PHYSICIAN`=300 sn → `TIER_3_RRT`=600 sn), NEWS2 tabanlı otomatik tetikleme (`NEWS2_ALARM_THRESHOLD=7`), hasta/branş bazlı eşikler, palyatifte "comfort" modu, ortalama yanıt süresi (avgTimeToAckSec) ve kademe sayaçları.

**Alarm sistemi "istediğimiz gibi" çalışıyor mu? — Dürüst teşhis:**
| Güçlü yön | Eksik / risk |
|---|---|
| Zaman tabanlı eskalasyon net ve deterministik | **Alarm yorgunluğu (alarm fatigue) ölçülmüyor** — false/aksiyon-alınmayan alarm oranı yok |
| Branş bazlı eşikler mevcut | Eşikler statik; **akıllı gecikme/geçici bastırma (smart delay/suppression) yok** — anlık artefakt gürültüsü kritik alarma dönüşebilir |
| Yanıt süresi metriği var | **Klinisyen başına alarm yükü** ve vardiya-saatine göre dağılım yok |
| NEWS2 skoru hesaplanıyor | **Tek skor**; sepsis (qSOFA/SIRS), deliryum (CAM-ICU), sedasyon (RASS) yok |
| Eskalasyon zinciri test ediliyor | **Geri bildirim döngüsü yok** — hekim "bu alarm doğru/yanlıştı" diyemiyor; sistem öğrenemiyor |

> **Sonuç:** Alarm motoru sağlam bir iskelete sahip ama "gürültüyü azaltan + öğrenen" katmandan yoksun. Madde 1, 2 ve 3 doğrudan bunu hedefler. Doktorların yapay zekayı eğitebileceği alan (Madde 4) bu döngünün kalbidir.

---

## Bölüm A — Alarm Zekâsı & Klinik Karar Desteği (En Yüksek Öncelik)

### Madde 1 — Alarm Yorgunluğu Analitiği & Akıllı Bastırma
Alarm başına: aksiyon-alındı mı, false mı, süreye/artefakta mı bağlıydı sınıflandırması. **Actionable vs non-actionable** oranı, birim/klinisyen/vardiya kırılımında "alarm/saat" yoğunluğu paneli. Ardışık aynı-parametre alarmlarını kümeleme (clustering) ve **N saniyelik akıllı gecikme** ile artefakt gürültüsünü kritik alarma dönüşmeden filtreleme. *Öncelik: Kritik · Efor: Orta · Bağımlı: mevcut escalation motoru.*

### Madde 2 — Uyarlanabilir (Adaptive) Eşikler & Alarm Politikası Editörü
Hekimin hasta bazında eşiği değiştirmesi + **gerekçe (rationale) ve süre (ör. sadece 4 saat)** girmesi; süre dolunca eşik otomatik geri döner. Birim/vardiya bazlı alarm politikası profilleri ("gece sessiz mod" vb.). Tüm değişiklikler denetim izinde. *Öncelik: Yüksek · Efor: Orta.*

### Madde 3 — Çoklu Skor Motoru: Sepsis / Deliryum / Sedasyon
NEWS2'ye ek olarak **qSOFA + SIRS** sepsis erken uyarı bundle'ı, **CAM-ICU** deliryum ve **RASS** sedasyon değerlendirme akışları. Her biri "…kriterleri değerlendirilecek" formatında uyarı üretir, teşhis koymaz. *Öncelik: Yüksek · Efor: Yüksek.*

### Madde 4 — ⭐ Klinisyen-Döngüde YZ Eğitim & Geri Bildirim Alanı
**Doktorların içerideki yapay zekayı eğitebileceği modül.** İçerik:
- **Alarm etiketleme:** her alarma "doğru / yanlış-pozitif / erken / geç" geri bildirimi + serbest not.
- **Öneri onayı:** YZ'nin ürettiği "değerlendirilecek" önerilerini hekimin onayla/reddet/düzelt döngüsü; kabul oranı metriği.
- **Vaka-tabanlı öğrenme kütüphanesi:** anonimleştirilmiş (sentetik) vakaları "altın standart" olarak işaretleme.
- **Model kartı & sürüm takibi:** hangi kural/ağırlık ne zaman değişti, kim onayladı — tam denetim.
- **Güvenli sınır:** eğitim geri bildirimi eşikleri/kural ağırlıklarını **öneri** olarak besler; canlıya alma daima insan onayıyla (human-in-the-loop). Sistem yine teşhis koymaz.
*Öncelik: Kritik/Stratejik · Efor: Yüksek · Bu, kullanıcının açıkça istediği modül.*

### Madde 5 — Klinik Kural Motoru (CDS Rules Engine)
Yönetici/hekimin kod yazmadan kural tanımlayabildiği editör: "IF SpO₂ < X AND FiO₂ > Y THEN öneri". Kurallar sürümlenir, test edilir (dry-run), denetlenir. Madde 4'ün ürettiği önerileri buraya bağlar. *Öncelik: Yüksek · Efor: Yüksek.*

---

## Bölüm B — Klinik İçerik Modülleri

### Madde 6 — Mekanik Ventilasyon Modülü
Ventilatör parametreleri (mod, PEEP, FiO₂, Vt, PIP, plato basıncı), ventilator-associated event (VAE) gözetimi, spontaneous breathing trial (SBT) kontrol listesi ve weaning takibi. *Öncelik: Yüksek · Efor: Yüksek.*

### Madde 7 — İlaç Güvenliği & İnfüzyon Yönetimi
İlaç-ilaç etkileşim kontrolü, doz aralığı doğrulama (mcg/kg/dk), infüzyon pompası entegrasyonu, eczacı (PHARMACIST rolü zaten var) onay iş akışı, yüksek-riskli ilaç çift-imza. *Öncelik: Yüksek · Efor: Yüksek · Bağımlı: PHARMACIST rolü (Faz D'de eklendi).*

### Madde 8 — Laboratuvar Entegrasyonu & Kritik Değer Uyarıları
Lab sonuç akışı (HL7), kritik değer (panik değer) otomatik bildirim ve onay zinciri, trend grafikleri (laktat, kreatinin, elektrolit). Sepsis bundle'ını (Madde 3) besler. *Öncelik: Yüksek · Efor: Orta.*

### Madde 9 — Klinik Bundle & Kontrol Listeleri (FASTHUG, VTE, Bası Yarası)
Günlük vizit kontrol listeleri (FASTHUG), VTE proflaksisi, bası yarası (Braden) ve düşme riski değerlendirmeleri; uyum (compliance) oranı raporlaması. *Öncelik: Orta · Efor: Orta.*

### Madde 10 — CRRT / Diyaliz & Sıvı Dengesi Genişletmesi
CRRT/diyaliz seansları, ultrafiltrasyon takibi, mevcut sıvı dengesi modülünün (Faz C) genişletilmesi. *Öncelik: Orta · Efor: Orta.*

### Madde 11 — Enfeksiyon Kontrolü & İzolasyon Takibi
İzolasyon durumu (Room modelinde `is_isolation` var), antimikrobiyal stewardship, HAI (hastane kaynaklı enfeksiyon) gözetimi ve bildirimi. *Öncelik: Orta · Efor: Orta.*

---

## Bölüm C — Operasyon, Kapasite & İnsan Kaynağı

### Madde 12 — Akuiteye Dayalı Personel & Vardiya Planlama
Hasta akuitesine (NEWS2/SOFA) göre hemşire-hasta oranı önerisi, vardiya çizelgeleme, iş yükü dengeleme; `max_beds_per_nurse` alanını canlı kullanır. *Öncelik: Yüksek · Efor: Yüksek.*

### Madde 13 — Kapasite Komuta Merkezi (Capacity Command Center)
Gerçek zamanlı yatak doluluk, bekleyen kabul/taburcu/transfer kuyruğu, tahmini boşalma (predicted discharge), çok-birim/çok-site tek ekran. Faz E ısı haritası ve KPI panelini üst katmanda birleştirir. *Öncelik: Yüksek · Efor: Orta.*

### Madde 14 — Tele-ICU / Uzaktan İzleme Konsolu
Merkezî bir konsoldan çoklu ICU'nun uzaktan izlenmesi, uzman hekimin uzaktan RRT desteği, düşük bant genişliği modu. *Öncelik: Orta · Efor: Yüksek.*

### Madde 15 — Mobil / Nöbetçi (On-call) Uygulaması
Nöbetçi hekim için push bildirim, hızlı alarm onayı, güvenli mesajlaşma; bildirim merkezi (Faz D) altyapısını kullanır. *Öncelik: Yüksek · Efor: Orta.*

---

## Bölüm D — Veri, Entegrasyon & Uyum

### Madde 16 — HL7 FHIR & IEEE 11073 Birlikte Çalışabilirlik Katmanı
Standart tabanlı cihaz/EMR entegrasyonu; şu an demo cihaz akışını gerçek HL7/FHIR adaptörlerine bağlar. Sağlık bilişimi için olmazsa olmaz. *Öncelik: Yüksek · Efor: Yüksek.*

### Madde 17 — Tahmine Dayalı Kötüleşme (Deterioration) Modeli
Vital trendlerden 6–12 saat önce kötüleşme riski öngören, açıklanabilir (explainable) skor. Sadece "…değerlendirilecek" önerisi üretir; Madde 4 geri bildirimiyle iyileşir. *Öncelik: Stratejik · Efor: Çok Yüksek.*

### Madde 18 — KVKK / HIPAA / GDPR Uyum & Gizlilik Panosu
Erişim günlükleri (denetim gezgini üzerine), veri saklama/silme politikaları, rıza (consent) yönetimi, PHI erişim raporları, DPO panosu. *Öncelik: Yüksek · Efor: Orta.*

### Madde 19 — Aile İletişim Portalı & Rıza / DNR Yönetimi
Aileye güvenli, sınırlı durum bildirimi; DNR/comfort care direktifleri, etik/onam kayıtları (palyatif comfort modu ile uyumlu). *Öncelik: Orta · Efor: Orta.*

### Madde 20 — Analitik Ambar & Araştırma / Kalite Dışa Aktarımı
Anonimleştirilmiş veri ambarı, SB/JCI kalite göstergeleri için otomatik hesaplama, araştırma amaçlı de-identified dışa aktarım, özel gösterge tasarımcısı. Faz E rapor stüdyosunu kurumsal ölçeğe taşır. *Öncelik: Orta · Efor: Yüksek.*

---

## Önerilen Sıralama (Dalga Planı)

| Dalga | Maddeler | Tema | Neden önce |
|---|---|---|---|
| **F1** | 1, 2, 4 | Alarm zekâsı + YZ eğitim alanı | Kullanıcının doğrudan sorduğu; en yüksek klinik değer |
| **F2** | 3, 5, 8, 17 | Skorlar + kural motoru + lab + tahmin | Karar desteğini derinleştirir |
| **F3** | 6, 7, 9, 10, 11 | Klinik içerik modülleri | Kapsam genişletme |
| **F4** | 12, 13, 15 | Operasyon & kapasite | Kurumsal ölçek |
| **F5** | 14, 16, 18, 19, 20 | Entegrasyon, uyum, tele-ICU | Pazara hazırlık |

> **İlk önerim:** Faz E biter bitmez **F1 (Madde 1 + 2 + 4)** ile başlamak. Bu üçlü, alarm gürültüsünü ölçülebilir biçimde azaltır ve doktorların YZ'yi eğitebileceği alanı hayata geçirir — yani senin iki ana sorunu (alarm doğruluğu + YZ eğitimi) tek dalgada kapatır.
