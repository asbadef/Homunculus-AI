# Referans Ekran Envanteri — CoMed / Pusula BAK (Rakip)

Kaynak: `C:\Users\Ozan Sunkur\Pictures\Screenshots\` — "Ekran görüntüsü 2026-10-25 *" (120 kare) + "2026-10-29 *" (2 kare), toplam 122 PNG.
Rakip sistem: **CoMed / Pusula BAK** (MLP Care, Türkiye kökenli), kurulum **LIV Bona Dea Bakü** (Azerbaycan). Pusula sürümü v1.5.31.x.
Tarama tarihi: 2026-11-04. Tüm 122 kare okundu (okunamayan yok).

## Önemli not — iki ayrı ürün katmanı
Rakip, **iki katmandan** oluşuyor:
1. **Modern web EMR** (`baku.comed.mlpcare.com`, "ComedEMR") — doktor/hemşire/eczane klinik tarafı. URL çubuğundaki `/medical/...` ve `?app-action=action-*` modülü ele veriyor. (yaklaşık 100 kare)
2. **Klasik masaüstü ERP** (.NET WinForms, başlık "… - Pusula BAK") — stok/eczane depo yönetimi, ilaç kartı, finans/İK/hakediş/satın alma, **yetki & rol yönetimi**. URL çubuğu yok; modül pencere başlığından okunuyor. (kareler 200221–201444)

## Bize ait kareler (rakip DEĞİL — karşılaştırma dışı)
- `202540` (localhost:5180) — **bizim Homunculus** Randevu listesi.
- `112140`, `112259` (localhost:5180) — **bizim Homunculus** Yataklar panosu (NEWS2, risk rozetleri).
Bunlar kıyas tarafı değil, bizim mevcut durumumuz.

## Azerbaycan lokalizasyon notu (genel)
Rakipte para birimi AZN'ye çevrilmiş ama **Türkiye'ye özel terimler gömülü kalmış**: Medula, SGK, SUT, UBB, ITS, E-Nabız, KDV, hatta bir raporda "Birim F.(TL)". Bu, MEMORY'deki "Azerbaycan'da Türkiye SUT/e-Nabız kullanma" kuralını doğruluyor — rakibin lokalizasyon eksiği bizim için fırsat, kopyalanacak bir şey değil. Arayüz Türkçe, klinik kataloglar (tanı/bölüm/bakım adları) Azerice ("müayinə", "baxım", "qulluq", "Aptek", "İcbari Tibbi Sığorta").

## PHI uyarısı
`201016` ve `201444` (Hasta Reçete Bilgisi) gerçek hasta ad-soyad/uyruk/protokol/reçete içeriyor. Bu envantere **hiçbir gerçek hasta adı yazılmadı**; sadece ekran yapısı kaydedildi. Bu dosya da hasta verisi barındırmamalı.

---

# MODÜL BAZLI ENVANTER

## 1. Doktor İş Listesi / Havuz / Randevular
**Referans kareler:** `192234`, `192247` (sol ana menü), `192259` (Randevular sekmesi).
**Ekran:** `/tr-tr/medical/` — üst sekmeler: İş Listesi (18), Havuz İş Listesi (0), Randevular (18), Tıbbi İkinci Görüş (0), **Muayene İmza (173)**, **Epikriz İşle (133)**.
Sütunlar: Hasta Bilgileri, Protokol Bilgileri (V-no | kurum | işlem tipi), Laboratuvar (x/x), Radyoloji (x/x), **Finansal K.** (rozet), Servis, İşlem Bilgileri, Randevu, Şube, İsteyen.

**Bizde eksik olabilecekler (önemli üstte):**
- **"Muayene İmza" ve "Epikriz İşle" ayrı iş-kuyruğu sekmeleri** — imzalanmamış muayene / işlenmemiş epikriz sayacı. Doktorun geride kalan imza borcunu gösteren ayrı kuyruk.
- **"Havuz İş Listesi"** — sahipsiz/havuzdaki hastalar (bir doktora atanmamış, kimin alacağı belli olmayan işler).
- **"Tıbbi İkinci Görüş"** sekmesi.
- İş listesi satırında **Lab (x/x) ve Radyoloji (x/x) ilerleme sayacı** (kaç tetkik istendi / kaç sonuçlandı) ve **Finansal uygunluk rozeti** doğrudan satırda.
- Cinsiyet renk kodu (E/K daire), bebeklerde "8ay 21gün" yaş gösterimi.

## 2. Muayene Editörü (Klinik Kart)
**Referans kareler:** `192342` (oftalmoloji muayene), `195051` (pediatri/yenidoğan muayene), `193405`, `192923` (Özgeçmiş modalı), `192642` (tamamlanmış muayene salt-okunur), `193416` (doküman tarihçesi/versiyon).
**Ekran:** `/hasta-tibbi-karti/{id}/patient-clinical-card/`. Üç kolon: Yakınması (Şikayet + Başlangıç Tarihi + Öykü 0/8000), Özgeçmiş/Soygeçmiş/Sistem Sorgusu, **Psikolojik Durum** (Sakin/Üzgün/Ajite/Kaygılı/Agresif), **Ağrı** (skor); Fizik Muayene Bulguları (Kilo/Boy/VKİ/VYA/Ateş/Nabız/KB-S/KB-D/SPO2); Tanılar (ICD-10); İzlem ve Plan.

**Bizde eksik olabilecekler:**
- **Yapılandırılmış "İzlem ve Plan" buton seti:** Ayaktan takip ve tedavi / Yatarak takip ve tedavi / Ayaktan cerrahi girişim / Yatarak cerrahi girişim / Rehabilitasyon / Palyatif / Kemoterapi + **"Ameliyat Planlanacak mı? Evet/Hayır"**. Tedavi kararını standart kodlara bağlıyor.
- **Tanı girişinde zengin alanlar:** Ayırıcı / Kesin / Ön Tanı ayrımı, **Taraf Tipi** (sağ/sol/ayrım yok), Ana Tanı işareti, İlk Tanı Tarihi, Evre.
- **Özgeçmiş modalı** çok kategorili: Alışkanlık (Sigara/Alkol/Madde), Kronik Hastalık, İlaç, Alerji, Ameliyat, Özel Durumlar, Aşı, Vücuda Takılan Cihaz, Kan Transfüzyon, Terapi + Meslek/Eğitim/Medeni Durum. Kritik alanlarda kırmızı "!" vurgusu.
- **Branşa özel muayene varyantı:** "Detaylı Çocuk Muayene Bulguları" linki; oftalmolojide göz muayene alanları (Görmə OD/OS, Ref, Tn, Fundus, GRV, eski gözlük SPH/CYL/AXIS).
- **Muayene doküman versiyonlama** (`193416`): her muayene "1. version" olarak imzalı saklanıyor; **"Kopyala"** ile önceki muayeneden kopyalayıp hızlı giriş (tekrar gelen hasta). 3 ayrı tarih: P.Açılış / Beyan / İmza.
- Araçlar: İmzayı Kaldır, **Akıllı Metin** (hazır metin blokları), Hasta Ön Beyanı, Görüntülü Görüşme.

## 3. Hasta Kartı — Demografik, Uyarılar, Gelişler
**Referans kareler:** `192451` (demografik bilgi kartı), `192440` + `194656` (Hasta Uyarıları ikon galerisi), `192506` (Tüm Gelişler).
**Bizde eksik olabilecekler:**
- **Hasta Güvenlik Uyarıları — renk+ikon galerisi** (~28 rozet): Düşme riski, Bası Yarası, Temas/Damla/Solunum izolasyonu, CPR, Kısıtlama, Nötropeni, RSV İzolasyon, Sarı Kod, Turuncu Kod, Koruyucu, Zor Hava Yolu, Stoma, Beslenme, Allojenik/Otolog vb. Her biri ayrı renk+ikon = hasta güvenlik bayrağı. **Çok güçlü referans; kendi uyarı setimiz için şablon.**
- Demografikte **"Merkez Hasta Numarası"** (şube hasta no'dan ayrı merkezi kimlik) — çoklu şube mimarisi. **"Baba Adı"** alanı (Azerbaycan ad yapısı).
- **"Tüm Gelişler"**: geçmiş protokol kartları + **"Protokol Yaşı"** (o gelişteki hasta yaşı) + geçmiş gelişe iliştirilmiş ICD tanısı; doktor/bölüm bazlı gruplama.

## 4. İstem (Order) — Tetkik / İlaç / Hizmet / Konsültasyon / Diyet / Bakım / Kan
**Referans kareler:** Tetkik(lab/rad) `192412`; İlaç `192723`; Hizmet `192736`; Konsültasyon `192752`; Diyet `192805`; Bakım `192815`; Kan Ürünleri `192827`; İstem Şablonları `192849`; İstem Tarihçesi `192603`; merkezi istem paleti `192356` / `193127` / `194205`.
URL deseni: `?app-action=action-order-{study|drug|procedure|consultation|nutritions|care|transfusion|templates}`.

**Bizde eksik olabilecekler (önemli üstte):**
- **İstem Şablonları (`192849`) — toplu protokol şablonu:** hazır tedavi setleri (ör. yoğun bakım beyin protokolü) satır satır ilaç/doz/yol/sıklık ile; **Benim / Bölümüm / Tümü** paylaşım kapsamı; "İsteme Dönüştür" ile tek tıkta toplu order. En değerli verimlilik özelliği.
- **İlaç isteminde CDSS (`192723`, `192904`):** kırmızı "Uyarı ve Etkileşimler" bölümü (İlaç Uyarıları sayacı), **"Etkileşim Sorgula"**, **"Kişi Kullanımı Bitmemiş İlaç Sorgula"** (çift reçete kontrolü). Doz Tipi (Standart/Hesaplanmış), Eşdeğer Ürün toggle, Sıklık (1/2/3/4/6/8/12 kez/gün), Sözel/Lüzum Halinde order, saat×doz özet tablosu + "Tümüne Uygula".
- **Kan Ürünleri isteminde transfüzyon güvenliği (`192827`):** kırmızı "Kan Grubu: Bilinmiyor" uyarısı, **Kan İstek Nedeni zorunlu**, "Hasta Kan Yönetimi" bağlantısı, Planlanan Veriliş Süresi.
- **Diyet isteminde (`192805`) refakatçi yemeği** (Var/Yok + ayrı sipariş), öğün bazlı özel diyet (diyabetik/tuzsuz/lohusa), Ara Öğün / Ek Öğün.
- **Konsültasyon (`192752`):** hedef bölüm + opsiyonel doktor + öncelik; **Konsültasyon Notu zorunlu**.
- **Çoklu kodlama:** Hizmet/tetkik kataloğunda aynı kalemde **SUT Kodu + Huv Kodu + TTB Birimi** ve "Paket (P)" işareti. (Not: Azerbaycan'da SUT/Huv kullanmayacağız — bizde kendi kod alanlarımız.)
- Her istem kataloğunda **Favoriler** (yıldız), sol **kategori ağacı**, "İstem Önerileri", "Daha Fazla Yükle" sayfalama.

## 5. Reçete (İlaç / Gözlük / Malzeme / E-Reçete)
**Referans kareler:** `192912` (Reçete Listesi girişi), `192904` (İlaç Reçetesi), `192951` (Gözlük Reçetesi).
**Bizde eksik olabilecekler:**
- **Gözlük/optik reçete (`192951`):** Uzak/Yakın türü, Cam Tipi/Rengi, Çerçeve, ADD, sağ/sol göz ayrı Sferik/Silendirik/Aks; **"Muayeneden Aktar"** (refraksiyon değerlerini muayeneden çek); + Lens / + Keratokonus Lens / + Teleskopik. (Branşa özel — bizde gerekirse.)
- İlaç reçetesinde provizyon tipi, reçete alt türü (Ayaktan/Taburcu), tanı tablosu, "Sık Kullanılan İlaçlar", "Varsayılan Olarak Ata".
- (Medula/e-Reçete butonları Türkiye'ye özel — bizde karşılığı Azerbaycan e-reçete olmalı, Medula değil.)

## 6. Ameliyat / Yatış / Taburculuk / Servis İşlemleri
**Referans kareler:** Ameliyat İstem `193008`; Ameliyat kodu seçimi + Kesi Tipi `193022`; Yatış İstem `193039`; Taburculuk `193056`; Servis/Yatak işlemleri `193114`; yatış tarihçesi `194647`.

**Bizde eksik olabilecekler (önemli üstte):**
- **Ameliyat öncesi kaynak planlaması tek formda (`193008`):** Anestezi Tipi, Anestezist Değerlendirmesi (iç/dış), Ameliyathane Kullanımı, **Kan Ürünü Rezerve**, **Frozen İstiyorum**, **Muhtemel Patoloji**, **Konsinye Kullanımı**, Özellikli Malzeme, Yoğun Bakım yatış süresi, Günübirlik.
- **Kesi Tipi kuralı (`193022`):** "Aynı seans+aynı kesi", "Farklı seans+farklı kesi", "Replantasyon" vb. — **faturalama kuralını belirliyor** (aynı seans indirimi). Euroscore (kardiyak risk) hesaplama butonu.
- **Taburculuk sonuç kodları (`193056`):** Şifa ile / Sevk / Vefat / Tedaviden vazgeçme / Eve gönderilme / Kontrol önerildi … — resmi istatistik için standart çıkış kodları.
- **Yatış türleri (`193039`):** Normal / Ameliyat / Yoğun Bakım / Medikal; "Gerekli Onamlar" + Onam Yazdır.
- **Servis işlemleri (`193114`):** Yatak Değişikliği + **Geçici Transfer** (tetkik için geçici yer); Kat → Blok → Yatak hiyerarşisi.
- **Yatış tarihçesi (`194647`) = audit:** her durum değişimi Eski→Yeni (durum, kat, yatak) loglanıyor (Servis Kabul: "İstek Yapıldı → Yatıyor").

## 7. İzlem (Sonuç Takibi) ve Sıvı İzlem
**Referans kareler:** İzlem sekmeleri `192528` (Laboratuvar/İlaç/Patoloji/Görüntüleme/Vital/Sıvı/Kan/Detaylı/Klinik Formlar/Tümü); Sıvı İzlem grafiği `192539`.
**Bizde eksik olabilecekler:**
- **"Diğer Şubeler" toggle** — başka şubelerin sonuçlarını getirme (çoklu şube). **VNA Portal** (görüntü arşivi) butonu.
- **Sıvı İzlem saatlik ızgara (`192539`):** Günlük/1-4-8-12 saat granülerlik; T. Alınan Sıvı / T. Dehidrasyon / T. Balans / T. Kan Balans / T. İrrigasyon Balans göstergeleri; her saat hücresine "+" ile giriş. (Bizde yatan hasta sıvı dengesi varsa kıyasla.)

## 8. Numune İşlem / Numune Alma (Laboratuvar iş akışı)
**Referans kareler:** Numune İşlem (Takip içinden) `194130`, `194138`; Numune Alma modülü `195151`–`195234`.
**Durum akışı sekmeleri:** Testler → Bekliyor → Alındı → **Tekrar** → Kabul → **Red** (her biri canlı sayaçlı).

**Bizde eksik olabilecekler (önemli üstte):**
- **Numune yaşam döngüsü tam akış** `Testler→Alındı→Kabul/Tekrar/Red` ayrı sekmeler + sayaçlar. Özellikle:
  - **Tekrar (`195210`):** "Tekrar Durumu: Evet" + "Numuneyi Tekrara Atan" kişi kaydı.
  - **Red (`195234`):** "Numune Reddedildi" + **red gerekçesi** (ör. "Cihazın 0, >> veya << Okuması") + "Numune Reddeden" sorumlusu.
- **Tüp tipi renk kodu:** Mor Kapak (EDTA), Sarı Kapak (Jelli), Heparinli, Kan Gazı Enjektörü, Gaita Kabı — numune kartında açıkça. Preanalitik hata önleme.
- **Finansal Kontrol** sütunu (tikli), **Ç. Süresi** (tahmini sonuç saati), VisitId, Numune No (benzersiz), "Hasta Barkodu Yazdır", "Numune Oluştur".
- VIP hasta rozeti numune listesinde.

## 9. Laboratuvar Test Rehberi (katalog)
**Referans kare:** `193258`.
**Bizde eksik olabilecekler:**
- Her test için **Örnek Türü + Tüp Tipi + Ön Hazırlık Süresi + Normal Çalışma Süresi + Acil Çalışma Süresi** sütunları. Dış laboratuvar testlerinde uzun süre (40-45 gün). Numune/tüp eşleştirmesi. **Excele Aktar**.

## 10. Görevler / Takip (Hemşire görev zaman çizelgesi) — EN ZENGİN BÖLÜM
**Referans kareler:** Takip zaman çizelgesi `194048`; görev aksiyon pop-up'ları `194103` (Uygula/Pas Geç/Pas Geç\Zayi/Planla), `194116`; **durum-renk LEJANTI `194148`**; Yazdır menüsü `194157`; **merkezi istem/aksiyon kataloğu `194205`**.
**Hemşire formları (hepsi `?app-action=action-*`):** Ağrı (vücut diyagramı) `194239`/`194243`; Bası Yarası (vücut şeması) `194251`; Aldığı-Çıkardığı `194334`/`194348`; Hemşire Gözlem Notu `194223`/`194357`; **Vital Bulgular + Erken Uyarı skoru** `194410`; Kan Şekeri/Diyabet `194428`; Hemşire Planlama `194441`; Toplu İlaç Uygulama `194452`; **Faaliyet/Olay/Bakım kataloğu** `194504`.

**Bizde eksik olabilecekler (önemli üstte):**
- **Görev durum-renk lejant sistemi (`194148`) — EN ÖNEMLİ TEK REFERANS.** Saat sütunlu Gantt benzeri çizelgede her görev tipi (İlaç/Lab/Kan/Radyoloji/Patoloji/Doküman/Bakım/Transfer/Diyet/Yoğun Bakım) kum saati rengiyle durum taşıyor:
  - sarı = Numune Bekliyor / Eczane Onayında / Diyetisyen Onayında
  - pembe = Uygulama Bekliyor / Numune Oluşturuldu
  - mavi = Hemşire/Kan Bankası Onayı Bekliyor
  - kırmızı kum saati = Uygulama Saati Geçmiş
  - mor dişli = İşlemde
  - yeşil tik = Uygulandı/Alındı/İmzalandı
  - gri tire = Pas Geçildi, kırmızı X = Reddedildi
  - Rozetler: A=Acil, L.H=Lüzum Halinde, N=Not içerir, +N=çoklu görev, H.Y=Hasta Yanında getirilen. **Bizim görev panomuz için doğrudan model.**
- **Görev aksiyonları:** Uygula / Pas Geç / **Pas Geç\Zayi** (atlama vs. zayi ayrımı) / Planla.
- **Vital Bulgular + yaşa özel erken uyarı skoru (`194410`):** otomatik "Skor", "Erken Uyarı Değerlendirmesi — Yenidoğan (0-30 Gün)" gibi yaşa özel skala (NEWS benzeri). (Bizde NEWS2 var; yaş-bantlı varyant ve otomatik skorun forma gömülmesi kıyaslanmalı.)
- **Yapılandırılmış hemşire formları:** Aldığı-Çıkardığı (IV/Oral/Parenteral/NG-OG/Kan/Periton… + Çıkardığı), Ağrı (vücut diyagramında bölge işaretleme), Bası Yarası (bası noktaları şeması), Kan Şekeri/İnsülin (uygulama bölgesi: deltoid/femur/umblikal — yenidoğan!). Formlardan doğrudan Diyet/İlaç istemi açılabiliyor.
- **Faaliyet/Olay/Bakım kataloğu (`194504`):** Başlat/Sonlandır tipli süreli işlemler (Entübasyon, CVP/Arter kateteri, Damar yolu, Dren, Lavman, Lomber ponksiyon…) + "Devam Eden Faaliyetler" sayacı.
- **Merkezi aksiyon paleti (`194205`):** tüm istem/takip/değerlendirme/toplu uygulama tek giriş noktasında, favorilenebilir.
- **Kimlik Bilekliği barkod baskısı** (Yazdır menüsü), Protokol Barkodu.
- Her kayıtta **"Kaydet ve İmzala"** (e-imza) + **Şablon Seç/Şablonlara Ekle** + Tarihçe.

## 11. Yatan Hastalar / Servis
**Referans kareler:** `193227`, `193234` (yoğun liste).
**Bizde eksik olabilecekler:**
- **Doluluk/durum sayaçları:** "1 Yat. Bekliyor / 46 Yatış / 1 Tab. Bekliyor / 0 Tab. Edildi" — canlı yatış durumu. **Kat/Blok filtresi** ("2. Mərtəbə 1. Blok +19"). Yenidoğanda 0 gün/doğum ikonu. ICU/NICU yatak kodları.
- Sütunlar: Tanı (ICD), Plan. Taburculuk Tarihi, Taburculuk Süresi, Durumu.

## 12. Hemşire Shift Yönetimi ve Vaka Takip
**Referans kareler:** Shift Özeti `195109`; **Hemşire-Hasta Ataması** `195117`; Vaka Takip `195138`.
**Bizde eksik olabilecekler (önemli üstte):**
- **Hemşire-hasta ataması (`195117`):** blok+vardiya (08-20 / 20-08) bazında; sayaçlar "Hemşire 8 (Atanan 7/Bekleyen 1), Hasta 61 (Atanan 13/Bekleyen 48)"; hasta kartına "Hemşire Ekle"; sorumlu hemşire yıldızı. Bu bizim **Devir** akışımızla ilişkili olabilir.
- **Shift Özeti (`195109`):** personel × gün takvimi, gündüz/gece ayrı sütun, çoklu blok ataması.
- **Vaka Takip (`195138`):** Düşme Riski / Nötropenik İzolasyon gibi açık vakalar; Devam Eden / Sonlandırılmış filtresi; aynı hasta birden çok vakada; Excele Aktar.

## 13. Eczane (web EMR tarafı)
**Referans kareler:** Eczane order listesi `195848`; İşleme Alma seçimi `195900`; **ilaç order detay + karşılama** `195911`; **Vademecum etkileşim sorgulama** `195921`; İade ve Zayi `195939`; Transfer stokları `200009`; Transfer Edildi listesi `200036`; **Kemoterapi order** `200102`/`200109`; hemşire iade `195301`/`200154`/`200205`; takip içi İade `194538`.
**Eczane sol menüsü:** Eczane, Kemoterapi Eczane, İade ve Zayi İşlemleri, Onaylanmış İlaçlar, Eczane/Kemoterapi Genel Durum Listesi, **Kritik Miktar Altındaki Stok**, **Miadı Geçen Ürünler**, Hasta Tıbbi/Kemoterapi Kartı, Advers Etki Bildirimi, Hastaya İşlenen Malzemeler.

**Bizde eksik olabilecekler (önemli üstte):**
- **Vademecum ilaç etkileşim motoru (`195921`) — güçlü CDSS referansı:** aktif ilaç listesi + **hasta özel durumları** (gebelik/emzirme/sigara/tuzsuz diyet/kontak lens/şok tedavisi…) + tanı + besin + semptom girdileriyle sorgu. Bizim ilaç güvenlik tarafımız için model.
- **İlaç order karşılama (`195911`):** durum sekmeleri (Bekliyor/Onaylandı/Transfer/Reddedildi/İptal), Onayla/Transfer Et/Reddet; satırda **muadil (eşdeğer) ilaç seçimi**, stok kaynağı (Eczane/Kat/Hasta), karşılanan miktar (editable), "Antibiyotik gün sayısı" rozeti.
- **Kemoterapi eczane (`200102`/`200109`):** **BSA/VYA bazlı küsuratlı dozaj** (3,7 adet), otomatik muadil eşleştirme ("M"), uygulama geri alma; izole oda konumları; "Kurum" = ödeyici (İcbari Tibbi Sığorta — zorunlu devlet sigortası).
- **İşleme Alma (`195900`):** eczacının istemi üzerine alması; ilaç isimleri **etken madde (jenerik) ile parantez içinde**.
- İade/Zayi (`195939`): İade Kabul / İade Red aksiyonu, "Pas Geçme Saati" (uygulanmadan geçilen ilaç), Çizgi Barkodu. (Bizde İADE/ZAYİ yeni eklendi — aksiyon tarafını kıyasla: eczacı onay/red, pas geçme bilgisi dokümanı.)
- Transfer stokları (`200009`): "EHU Durum Bilgisi", "Yazdırma Durumu" sütunları.

## 14. Protokol İşlem / Sarf Çıkışı (hizmet + malzeme kalemleri)
**Referans kareler:** Protokol İşlem listesi `192653`, `194608`; **Hastaya Çıkış** (depo+malzeme) `194618`; stok+**Lot Bilgileri** `194629`.
**Bizde eksik olabilecekler:**
- **Hastaya sarf çıkışı (`194618`/`194629`):** Depo seçimi → stok listesi (Kodu/Resmi Barkod/Adı/Malzeme Tipi/**İlacın S.K.T.**/Mevcut/Kat); **Lot/Seri takibi** (Lot No, Üretici Lot No, Seri No, S.K.T.); barkodla çıkış; **Sarf Şablonları**.
- Protokol işlem satırında Durum (İşlemde=mor dişli), Yapan/İsteyen Doktor, SUT Kodu, Hizmet Verilme Yeri, Depo, "Hastaya Çıkış", satır sil.

## 15. Epikriz / Onam / Dokümanlar
**Referans kareler:** Epikriz görüntüle `193145`; merkezi işlem paleti (Epikriz alt menü) `193127`; **Onam/Rıza formu arama** `193155`; Dokümanlar listesi `192632`; **Doküman Tanımları kütüphanesi** `193211`.
**Bizde eksik olabilecekler:**
- **Onam/Rıza formu kütüphanesi (`193155`):** "Visite Özel / Tüm Onamlar" (işleme/branşa özel rıza formları); imzalı belge; "İmzayı Kaldır".
- **Geniş form/doküman kütüphanesi (`193211`):** 10+ sayfa; rol bazlı kategori (Hemşire/Hekim/Kurum/Hasta); "Skor" sütunu (skorlanabilir formlar); Rapor ve Takip Formları.
- Dokümanlarda imzalı kilit ikonu, DICOM/VNA yükleme, imzalayan/oluşturan ayrımı.

## 16. Hasta Takip & Yönlendirme (otomatik periyodik takip)
**Referans kareler:** Takip tipi seçimi `192933`; takip aralığı+süre `192939`; Yönlendirme `193405`.
**Bizde eksik olabilecekler:**
- **Otomatik periyodik takip üretimi (`192939`):** Takip Aralığı (3 Ayda bir) + Süre (1 Yıl boyunca) → sistem otomatik 4 takip randevusu üretiyor ("önizleme: 4 adet"). Branşa özel takip tipleri.
- **Yönlendirme (`193405`):** başka şube/bölüm/doktora planlama saatiyle sevk.

## 17. Arama / Bildirimler / Ajanda / Profil (çatı)
**Referans kareler:** Protokol/Hasta Arama `193315`; Bildirimler `193324`; Ajanda `193336`; Profil `193345`.
**Bizde eksik olabilecekler:**
- **Arama (`193315`):** 4 mod — Hasta / Protokol / **İstem Arama** / **Detaylı Doküman Arama**; kapsam **Benim / Bölümüm / Tümü** (yetki filtresi).
- **Bildirimler (`193324`):** konsültasyon istek/sonuç + radyoloji sonucu doğrudan bildirimde (rapor metniyle); Yeni/Geçmiş.
- **Ajanda (`193336`):** haftalık randevu takvimi; "Kapalı-Ameliyat/İstirahat/Poliklinik" blokları; renk lejantı (bekliyor/geldi/gelmedi/izinli).
- **Profil (`193345`):** "Açık Oturumları Gör" (oturum yönetimi), QR kod, 3 dil (TR/EN/AZ), sürüm/IP, "Comed Dr Kod Göster".

## 18. Ana Dashboard — Modül/Rol Kartları
**Referans kare:** `193601`.
14 modül kartı: **Doktor, Hemşire, Sağlık Turizmi, Diyet, Eczane, Patoloji, Onkoloji, PRM, Ameliyathane, Klinik Raporlama, Fizik Tedavi, BaşHekimlik, Profil, Yönetim.**
**Not:** "Sağlık Turizmi" (uluslararası hasta) ve "PRM" (hasta ilişkileri) ayrı modüller; Patoloji/Onkoloji/Ameliyathane/Fizik Tedavi ayrı roller. Bize ileride modül haritası için referans.

## 19. KLASİK MASAÜSTÜ ERP (Pusula BAK .NET) — Stok / İlaç Kartı / Eczane Admin / Yetki
**Referans kareler:** Ana menü `200221`/`200230`; **Order Değerlendirme** `200250`; İlaç Talep Karşılama `200315`/`200405`; **Onay Bekleyen İşlemler** (depo giriş/transfer) `200327`; Hasta Stok `200414`; **Order Analiz** `200429`; Miadı Geçen `200447`; **Kritik Stok** `200516`; **Miadı Yaklaşan** `200526`; İlaç Listesi `200815`; **İlaç Kartı sekmeleri** `200836`–`200941`; **Hasta Reçete Bilgisi** `201016`/`201444`.

**Üst araç çubuğu (admin):** Vezne Paneli, Personel Listesi, **Kullanıcı Yetkileri & Rol Listesi**, **Güvenlik Tanımları**, **Kullanıcı İzleme**, **Agent Yönetimi**.
**Sol modül listesi (tam ERP):** Hasta Kabul, Tedavi, Diş Tedavi, Laboratuvar, Tetkik ve Radyoloji, Stok, Eczane, Satın Alma, Sterilizasyon, Finans, Hakediş, İK, Ortak, Randevu, **Medikal Muhasebe**, Tıbbi Arşiv, Kalite, İstatistik ve Analizler, CRM, Dijital Arşiv, Döküman Yönetimi, E-Nabız, Entegrasyon, ComedEMR, Merkez, Kiosk, Sistem.

**Bizde eksik olabilecekler (önemli üstte):**
- **İlaç/Malzeme kartı — çok sekmeli derinlik (`200836`–`200941`):** Genel / İlaç Bilgileri / Eşdeğer Ürün / Depolama / Tedarikçi-Üretici / Diğer / Vademecum / Resim / Fiyat / Rapor.
  - İlaç Bilgileri: Yüksek Riskli, **EHU Onayı Gerektirir** (+ onay günü, yatış tipine göre farklı), Majistral, Pediatrik, Karekodlu, cinsiyete özel; **Erişkin/Çocuk ayrı tanımlı günlük doz**, doz kısıtlamaları.
  - Eşdeğer: **Yakın Eşdeğer / Tam Eşdeğer grup** (muadil yönetimi).
  - Depolama: **depo bazlı Min/Kritik/Max (miktar + gün)** + **"Otomatik Stok Talebi Oluşsun"** (otomatik ikmal).
  - Diğer: ilacı hizmet/lab/rad ile ilişkilendirme; barkod/lot/seri; özellik bayrakları (Işığa Duyarlı/Soğuk Zincir/Konsinye/Hastaya İşlenebilir).
- **Stok uyarı pencereleri:** Kritik Miktar Altındaki Stok (`200516`, Min/Kritik/Max/Tümü filtreli, kırmızı vurgu), Miadı Yaklaşan (`200526`, Süre=90 gün, "dolan/30 günden az" lejant), Miadı Geçen + **İmha Et** (`200447`). (Bizde kritik/miad var — rakibin depo-bazlı seviye + otomatik talep + imha akışını kıyasla.)
- **Order Değerlendirme (`200250`) ve Order Analiz (`200429`):** eczacının order değerlendirme konsolu; renk lejantı (Sözel/Kırmızı/Mor/Turuncu/Yeşil Reçete, Yoğun Bakım, Narkotik), bayraklar (E=EHU, Y=Yüksek Riskli, M=Majistral, I=Işığa Duyarlı, S=Soğuk Zincir, İ=İlk Kullanım). Order uygulama analizi (planlanan vs gerçekleşen, uygulayan, pas/red/stop).
- **İlaç Talep Karşılama (`200315`):** birimler arası depo talebi karşılama (Talep Eden/Karşılayan Depo, Dummy Talebi).
- **Onay Bekleyen İşlemler (`200327`):** depo giriş fişleri onayı (Alım/İade/Satış İrsaliyesi, lot/seri bazlı), grid gruplama.
- **Hasta Stok (`200414`):** hasta üzerindeki ilaç (birim doz) takibi; dozaj bazlı ayrı miktar/birim.
- **YETKİ & ROL YÖNETİMİ (`200221`/`200230`):** "Kullanıcı Yetkileri & Rol Listesi", "Güvenlik Tanımları", "Kullanıcı İzleme" (denetim), "Agent Yönetimi". Bizim **Faz-0 yetki modeli** için rakip karşılığı burada; detay ekranları bu karelerde açılmamış (sadece menü adları görünüyor).
- **Hasta Reçete Bilgisi (`201016`/`201444`):** hasta bazlı reçete arama/listesi; sağ tık "Protokole İşle". (PHI içeriyor — not alınmadı.)

---

# VEZNE / FATURA — referans eksikliği notu
Bu ekran görüntüsü setinde **vezne/fatura kesme web ekranı yok**. Faturalama rakipte **masaüstü ERP** tarafında (Medikal Muhasebe, Finans, Hakediş, üstteki "Vezne Paneli" butonu) duruyor ama **açılmış bir vezne/fatura ekranı yakalanmamış**. Dolayısıyla bizim vezne modülümüz (fatura kesme, satır-kalem, kurum payı/KDV, indirim onay, GFK, evrak, iade) bu set ile **doğrudan kıyaslanamadı**. İpuçları: Kesi Tipi kuralının faturaya etkisi (`193022`), çoklu kodlama (SUT/Huv/TTB), "Kurum" = ödeyici/sigorta, AZN para birimi, KDV %10/%18 ilaç kartında. Vezne kıyası için ayrı ekran görüntüsü gerekli.

---

# EN KRİTİK EKSİKLER (öncelik sırası)

1. **Görev durum-renk lejant sistemi (`194148`)** — görev tipi × kum saati rengi ile tek bakışta durum (bekliyor/geçmiş/uygulandı/pas/red) + rozetler (A/L.H/N/H.Y). Hemşire görev panomuzun bel kemiği; doğrudan model.
2. **Hemşire görev çizelgesi + yapılandırılmış hemşire formları** — saatlik Gantt (`194048`), Uygula/Pas Geç/Pas Geç\Zayi/Planla aksiyonları, Aldığı-Çıkardığı, Ağrı (vücut diyagramı), Bası Yarası, Kan Şekeri/İnsülin, Toplu İlaç Uygulama, Faaliyet/Olay/Bakım kataloğu.
3. **İstem Şablonları — toplu protokol şablonu (`192849`)** — hazır tedavi setlerini (örn. YBÜ protokolü) tek tıkla isteme dönüştürme; Benim/Bölümüm/Tümü paylaşım kapsamı. En yüksek verimlilik kazancı.
4. **İlaç CDSS: etkileşim + muadil + çift reçete** — `192723`/`192904` (Etkileşim Sorgula, Kişi Kullanımı Bitmemiş İlaç Sorgula) ve `195921` Vademecum (hasta özel durum + tanı + besin + semptom).
5. **Vital Bulgular + yaşa özel otomatik erken uyarı skoru (`194410`)** — skorun forma gömülü ve yaş-bantlı olması (yenidoğan 0-30 gün). Bizim NEWS2'yi yaş varyantı + otomatik skorla genişletmek.
6. **Numune yaşam döngüsü tam akışı (`195151`–`195234`)** — Tekrar ("Tekrara Atan") ve Red (red gerekçesi + "Reddeden") sekmeleri + tüp kapak renk kodu + Ç. Süresi.
7. **İş listesinde "Muayene İmza" ve "Epikriz İşle" borç kuyrukları + Havuz İş Listesi (`192234`)** — imzalanmamış muayene/işlenmemiş epikriz sayacı; sahipsiz iş havuzu.
8. **Hasta güvenlik uyarıları — renk+ikon galerisi (`192440`/`194656`)** — Düşme/İzolasyon/CPR/Nötropeni/Sarı-Turuncu Kod/Zor Hava Yolu vb. standart bayrak seti.
9. **Ameliyat öncesi kaynak planlaması (`193008`) + Kesi Tipi faturalama kuralı (`193022`)** — kan rezerve/frozen/konsinye/anestezi tek formda; kesi tipi aynı-seans indirim kuralı.
10. **İlaç/Malzeme kartı derinliği (`200836`–`200941`)** — EHU onayı (yatış tipine göre), Erişkin/Çocuk doz, Yakın/Tam Eşdeğer grup, **depo bazlı Min/Kritik/Max + otomatik stok talebi**, ilaç-hizmet ilişkilendirme.
11. **Eczane Order Değerlendirme/Analiz konsolu (`200250`/`200429`)** — reçete renk lejantı + bayraklar (EHU/Yüksek Riskli/Narkotik/Soğuk Zincir) + planlanan vs gerçekleşen uygulama analizi.
12. **Hemşire shift + hasta-başı hemşire ataması (`195109`/`195117`)** ve **Vaka Takip (`195138`)** — vardiya planı, hasta-hemşire atama sayaçları, açık vaka (düşme/izolasyon) takibi.
13. **Muayene "İzlem ve Plan" standart buton seti + zengin tanı (ayırıcı/kesin/ön, taraf, evre) (`192342`)** ve **muayene kopyalama/versiyonlama (`193416`)**.
14. **Hastaya sarf çıkışı — Lot/Seri/S.K.T. takibi + sarf şablonu (`194618`/`194629`)**; stok uyarıları + **Miadı Geçen → İmha Et** (`200447`).
15. **Otomatik periyodik takip üretimi (`192939`)** — aralık+süreden otomatik takip randevusu; + Onam/Rıza formu kütüphanesi (`193155`) ve "Diğer Şubeler" çoklu-şube sonuç getirme (`192528`).

> Kapsam dışı kalan: Bu sette vezne/fatura web ekranı, admin yetki/rol **detay** ekranları (sadece menü adları), ve ERP finans/İK/hakediş iç ekranları açılmamış — bu modüllerin kıyası için ek ekran görüntüsü gerekli.
