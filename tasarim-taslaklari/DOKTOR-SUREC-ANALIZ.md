# Doktor (Klinik) Süreç Analizi — 35 Eğitim Videosundan

> Kaynak: Pusula BAK (MLP Care) HBYS doktor/klinik eğitim videoları (35 adet).
> Bu belge referans sistemin DOKTOR iş akışını karelerden çıkarır. Amaç: kendi
> HBYS'mizin (asbadef / homunculus prototipi, Azerbaycan pazarı) doktor modülünü
> buna göre kurmak. Ekran adlarını birebir KOPYALAMIYORUZ — mantığı alıyoruz,
> kendi Azerice adlarımızı/görsel kimliğimizi kullanıyoruz.
>
> **Azerbaycan uyarlaması:** Türkiye'ye özgü entegrasyonlar BİREBİR alınmaz:
> Medula/SGK → **SAMHI / İcbari Tibbi Sığorta**, e-Nabız → **TƏBİB / e-tabib**,
> e-reçete (TR) → Azerbaycan reçete akışı. Bu noktalar belgede `[AZ]` ile işaretlidir.
>
> **Yöntem notu:** Her video için ffmpeg ile 4 sn'de 1 kare çıkarıldı (ffmpeg 9.0.2,
> kurulu). Kareler Read ile incelendi, bölüm yazıldıktan sonra silindi. PHI/hasta
> verisi analize alınmadı; sadece ekran/akış mantığı.
>
> Son güncelleme: 2026-10-25

---

## 0. Doktor modülünün çekirdek mantığı (her şeyin temeli)

Referans sistemde doktorun dünyası **Hasta → Protokol (geliş) → Muayene Kartı → İstem/Order → Sonuç → Epikriz** zinciridir:

1. Doktor kendi **iş listesi / hasta listesi** üzerinden çalışır (bekleyen hastalar, randevulular, yatanlar). Vezne protokolü açar, hasta doktorun listesine düşer.
2. Her hasta gelişi bir **protokol**e bağlıdır; doktor o protokol için bir **muayene/hasta kartı** açar.
3. Doktor karttan **istem** (order) yapar: laboratuvar, radyoloji, ilaç (order), konsültasyon, ameliyat, yatış, taburculuk. İstemler vezne/hemşire/ilgili birime düşer.
4. **Sonuçlar** (lab, radyoloji görüntü, patoloji, konsültasyon cevabı) doktora geri gelir.
5. Doktor **epikriz / rapor / gözlem notu** yazar, reçete düzenler, dökümanları yönetir.

Tekrar eden kalıplar: **favori/şablon** (sık kullanılan istem/order setleri), **tarihçeden aktarma** (önceki gelişten veri kopyalama), **footer/alt menü hızlı erişim**.

---

## 1. Genel hasta arama + doktor iş listesi (Video 1)

**Ekran:** Doktorun ana giriş noktası = **İş Listesi** (hasta çalışma tezgâhı).

- Üst grid = bekleyen hastalar. Sütunlar: **Protokol Bilgileri**, **Laboratuvar** (ör. 0/0), **Radyoloji**, **Gider**, **Finansal Kontrol** (ör. "Finansal Kontrol Uygun"), **İşlem Bilgileri** (ör. "Genel cerrahi muayenesi" + durum "Bekliyor" + saat). Her satırda hasta adı, yaş/doğum, protokol no, sigorta (ör. "SGK Yurtiçi").
- Üst filtre şeridi: tarih aralığı, **Menuel İş Listesi**, **Randevular**, **Tıbbi İkinci Görüş**, **Epikriz İşlemi** sekmeleri.
- **Hasta arama kutusu** + kapsam seçimi **Benim / Bölümün / Tümü** + **Ayrıntılı Filtre**. Arama kriterleri: Ad, Soyad, Hasta No, Kimlik No.
- Arama sonucu grid: Ad Soyad, Cinsiyet, Doğum Tarihi, Baba Adı, Hasta No, Özel Durum.
- Hasta seçilince alt panelde **protokol/geliş geçmişi**: Protokol Tarih, Protokol No, Şube, Protokol Durumu (Açık/Kapalı), Protokol Tip (Genel Muayene/Ameliyat/Kontrol), Geliş Tip (Ayaktan/Yatan), Bölüm-Doktor, Kapanış Tarih. "Protokol Açma" aksiyonu mevcut.
- Bir protokol açılınca **Muayene Kartı** gelir (Video 5'te detaylı). Sağ kenarda doktor modülü ana menüsü: **Tüm Gelişler, İşlem, Laboratuvar/Görüntüleme, Patoloji, Yatış, İşlem Tarihçesi, Ameliyat Raporu, Konsültasyon, Dokümanlar, Protokol İşlem, Takip, Hasta Takip, Bakım Planı, Randevular**. Alt (footer) sağda **e-nabız** düğmesi `[AZ: TƏBİB/e-tabib ile değişir]`.

**Çıktı/sonuç:** Doktor hastayı bulur, gelişini/protokolünü seçer, muayene kartına girer. Bu ekran doktor modülünün "çatısı"dır.

## 2. Hasta iş listesi yönetimi (Video 2)

**Ekran:** İş Listesi'nin filtre/düzen yönetimi (Video 1'deki tezgâhın kullanımı).

- Üst sekmeler: **İş Listesi · Manuel İş Listesi · Randevular · Tıbbi İkinci Görüş · Epikriz İşlem**.
- Üst toolbar durum/filtre rozetleri: **Bekliyor / İşlemde / Tamamlandı** sayaçlı filtreler (ör. rozette "3", "2"), onay (✓) filtreleri, **tarih aralığı** seçici (haftalık takvim popup'ı), kapsam (Benim/Bölümün).
- Grid sütunları: Hasta Bilgileri (ad, yaş, doğum, hasta no), Protokol Bilgileri (protokol no, sigorta), **Laboratuvar** (ör. 6/10 = sonuçlanan/istenen), **Radyoloji** (ör. 0/2), Şube, **Finansal Kontrol** ("Finansal Kontrol Uygun" / "Ödeme Bekliyor"), **İşlem Bilgileri** (muayene adı + durum "Bekliyor/İşlemde/Tamamlandı" + saat), **Görevine Git / Görüntüle**.
- Satır rengi/rozet ile hasta durumu hızlı görülür; muayenesi bitmiş hasta "Tamamlandı" yeşil, bekleyen kırmızı/mor işaretli.

**Mantık:** Doktor gün içinde kuyruğu buradan yönetir: hangi hasta bekliyor, hangisinin lab/radyoloji sonucu geldi (sayaç), hangisinin ödemesi/finansal kontrolü tamam. Lab/radyoloji **x/y sayacı** çok işlevsel — sonuç gelince doktor görür.

**[AZ]** Sigorta sütunu "SGK Yurtiçi" yerine **İcbari Tibbi Sığorta / özel** olmalı; finansal kontrol SAMHI müstehaklığıyla ilişkilenir.

## 3. Laboratuvar / radyoloji isteği (order) nasıl yapılır (Video 3) — KRİTİK

**Ekran:** Muayene kartından açılan **İstem (Order) ekranı**.

- Sol ağaç: **Favoriler · Laboratuvar · Radyoloji** (Radyoloji altında Röntgen, MR, USG/Ultrason, BT/Bilgisayarlı Tomografi, Mamografi, Renkli Doppler, Sintigrafi...).
- Orta/sağ liste: hizmetler (Ad, Grubu, Açıklama) + her satırda **yıldız = favoriye ekle** ve **checkbox = seç**. Üstte arama.
- Seçince alt panelde istem detayı: **Hizmet Verilme Yeri, Adet, Açıklama, Hasta Başı Çekim, Rapor durumu, Çekim Hizmeti, Vücut Bölgesi, İstem Önceliği**. Düğmeler: **Vazgeç · Planla · Ekle**.
- Üstte **Order Tip Seçin** dropdown, **AKİF Protokol / Hasta** radyosu, **İstem Yazdır**.
- Ekle → yeşil **"Kayıt başarılı"** toast → istem alttaki order grid'ine düşer: İstem Tip, İstem Bilgisi, **Uygulayan** (doktor), İstem Tarihi, Tedavi Baş. Tarihi, **İstem Durumu (AKİF)**, sil.
- Order ekranı üst sekmeleri (tüm istem türleri tek yerde): **Baş İstem · Diyet İstem · Bakım İstem · Kan Ürünleri İstem · Tetkik İstem · Hizmet İstem**.
- **İptal:** satır → iptal → **İptal Nedeni Seçin** (Yanlış İstem Seçimi / Yanlış Hastaya Giriş / Muhasebe Giriş / İstem İptali / Diğer) + açıklama → onay.

**Çıktı:** Lab istemi laboratuvara, radyoloji istemi radyolojiye düşer; aynı istem vezne iş havuzuna fatura kalemi olarak gider (Vezne analizi Bölüm 5 "İstek Havuzu" ile eşleşir).

**[AZ]** Katalog/kodlar Azerbaycan'a göre (SAMHI hizmet kodları); Türkiye SUT kodu kullanılmaz. Favori/şablon mekanizması aynen değerli.

## 4. Reçete yazma (Video 4) — TR'YE ÖZGÜ, UYARLAMA ŞART

**Giriş:** Muayene kartının **hızlı işlem ızgarası** (footer/menü ikonları) üzerinden. Bu ızgarada doktorun tüm aksiyonları ikon olarak var: Tetkik İstem, Hizmet İstem, Diyet/Bakım/Kan Ürünleri İstem, İstem Şablonları, **İlaç Reçetesi**, **Mükerrer Reçete**, **E-Reçetem**, Yatış İstem, Transfer İstem, Ameliyat İstem, Onam Arama-Yazdır, Epikriz, **Medula Raporları**, E-rapor.

**Akış:** **E-Reçetem** tıklanınca **ayrı bir "Reçetem" portalı** açılır (Türkiye Sağlık Bakanlığı / Medula e-reçete sistemi — HBYS içine gömülü dış uygulama). Sol menü: Yeni Reçete Oluştur, Reçetelerim, Yatan/Günübirlik İl. İşlemleri, Yurtdışı İlaç Reçeteleri, Ruhsatsız/Endikasyon Dışı Başvuru, Hazır Şablonlar, Onay Bekleyen Reçeteler, İlaçlar, Profil.
- **Yeni Reçete Oluştur:** Hızlı Reçeteler (şablon), **Tanı ve Reçete Türü** (Tanı kodu/adı = ICD-10 ara), **Reçete Bilgisi** (İlaç Adı ara), Reçete Türü, "Reçeteyi Kaydet".

**[AZ] ÖNEMLİ:** Bu akış **birebir alınmaz**. "Reçetem/Medula e-reçete" Türkiye'ye özgüdür. Azerbaycan'da:
- Dahili reçete ekranı (tanı/ICD-10 + ilaç arama + doz/kullanım + kaydet + yazdır) kendi sistemimizde kurulur.
- Varsa Azerbaycan ulusal e-reçete entegrasyonu `[AZ]`; yoksa yalnızca dahili + basılı reçete.
- ICD-10 uluslararası olduğu için tanı seçimi korunur; ilaç listesi Azerbaycan ilaç kayıt veritabanı olmalı.

## 5. Hasta tıbbi kartı (Muayene Kartı) doldurma (Video 5) — EN KRİTİK EKRAN

Doktor modülünün kalbi. Üç kolonlu tek sayfa. Üst toolbar: **Kaydet · Kapat ve İmzala · Şablonu Seç · Şablonlara Ekle · Tarihçe · Favoriler**. Üstte hasta kimlik şeridi (ad, yaş, cins, protokol, kronik hastalık/alerji uyarısı kırmızı).

**Sol kolon — Anamnez:**
- **Yakınması** (şikâyet) + Başlangıç Tarihi (saat/gün/ay/yıl + "Önce") + favoriden seç.
- **Öyküsü / Özgeçmiş:** Genel Durum, Bilinç Durumu (Açık), Kooperasyon/Oryantasyon, Kan Transfüzyonu, Alkol, Sigara, Operasyon, Tanı, Travma, Alerji, Kronik Hastalık; kadında Gebe/Düşük/Abortus.
- **Soygeçmiş (aile öyküsü):** aile bireyi bazında (Baba/Anne/Kardeş/Amca/Dayı/Hala...) hastalık ızgarası (Diyabet, Hipertansiyon, Kardiyak, Malign...) + "Anne-Baba akraba" kutusu.
- **Psikoloji:** Sakin/Üzgün/Kaygılı/Agresif + açıklama.
- **Ağrı:** Bölge / Düzey (skala) / açıklama.
- **Sistem Sorgusu (ROS):** büyük diyalog — Genel, Sinir, Gastroüriner, Kas-İskelet, Dolaşım, Deri, Solunum, Gastrointestinal sistemler; her biri işaretlenebilir bulgu listesi (Özellik Yok / Kilo kaybı / İştahsızlık / Baş dönmesi...).
- **Hasta Özel Notları** + Yeni Ekle.

**Orta kolon — Muayene ve Karar:**
- **Fizik Muayene Bulguları:** vitaller satırı (Boy, Kilo, VKİ/BMI, Ateş, Nabız, SPO2, **Tansiyon**...) + Muayene Notu. **Detaylı Fizik Muayene** diyaloğu: sistem sistem (Baş-Boyun, Solunum, Nörolojik, Kardiyovasküler, Batın, Genito-Üriner, Kas-İskelet, Periferik Nabızlar).
- **Tanılar (ICD-10):** sekmeler **Protokol / Branş / Tümü**, tanı arama, **Ön Tanı / Kesin Tanı / Ayırıcı Tanı** tipi, **Taraf (Sağ/Sol)**; tanı ızgarası (Kod, Ad, Tip, Tarih). "Kesin Tanıya Dönüştür". Yeşil "İşlem başarılı" toast.
- **İzlem ve Plan:** Tedavi Notu + karar düğmeleri: **Ayaktan takip ve tedavi / Yatarak takip ve tedavi / Ayaktan cerrahi girişim / Yatarak cerrahi girişim / Rehabilitasyon / Palyatif tedavi**; **Kontrol Önerildi** (tarih) + **Kontrol Notları**.

**Sağ sidebar (doktor modülü menüsü):** Tüm Gelişler, İşlem, Laboratuvar/Görüntüleme, Patoloji, İşlem Tarihçesi, Ameliyat Raporu, Konsültasyon, Dokümanlar, Görevler, Protokol İşlem, Takip, Hasta Takip, Bakım Planı, Randevular.

**Çıktı:** Doldurulup **Kaydet** → muayene kaydı; **Kapat ve İmzala** → geliş kilitlenir. Her bölüm **şablondan** yüklenebilir / **şablona** kaydedilebilir (verimlilik için kritik).

**[AZ]** ICD-10 ve klinik alanlar uluslararası, korunur. Arayüz Azerice olmalı. Bu ekran prototipte NEREDEYSE TAMAMEN EKSİK → en yüksek öncelik.

## 6. İlaç Order (yatan hasta ilaç istemi) (Video 6) — KRİTİK, CDSS içerir

**Ekran:** Muayene kartı hızlı ızgarasından **İlaç Order**. Reçeteden ayrı — bu **dahili hekim ilaç istemi** (yatan/servis), e-reçete değil.

- İlaç seçimi sekmeleri: **Sık Kullanılan / Temel İlaç / Tümü** + İlaç Tip + **Standart Doz / Hesaplanmış Doz**. Hastanın **kg/cm/m²** değerleri doz hesabı için.
- **Etken madde / ilaç adı ara** (barkodlu dropdown). **Veriliş Yolu**: IV-İnfüzyon, IV-Bolus, IV-PCA, IM-İntramüsküler, Epidural PCA, Oral, SC...
- Doz detayı: Doz (mg), Adet, Hacim (ml).
- **Uygulama tipi:** Acil / Lüzum Halinde / **Planlı**. **Sıklık:** 1/2/3/4/6/12 Kez veya Özel. Tedavi Başlangıç Tarihi + Tedavi Süresi + Özet.
- **Uygulama zamanı:** Aç karnına / Tok karnına / Yemekten önce / Yemeklerle birlikte / fark etmez...
- **İlaç Etkileşim Uyarıları paneli (DDI + gebelik):** "Hamilelik Uyarısı", doz aşımı, ilaç-ilaç etkileşim uyarıları — **klinik karar destek (CDSS) özelliği**.
- Ekle → order grid: İlaç Bilgisi, Durum, Veriliş Yolu, Uygulama Tip, Tedavi Baş/Bit, Uygulayan, İstem Tarihi; renkli durum ikonları.
- Order satır durumu: **AKİF / Durduruldu / Reddedildi / Tamamlandı**.
- **İlaç uygulama matrisi (eMAR benzeri):** Toplam, **Eczane Onayında**, **Hemşire Onay Bekliyor**, Uygulama Bekliyor, Uygulandı, Pas Geçildi, Reddedildi, Durduruldu — zaman dilimli. İstem → eczane onayı → hemşire uygulaması zinciri.

**Çıktı:** İlaç istemi eczaneye (onay) ve hemşireye (uygulama) düşer; ilaç stoktan çıkar (Vezne analizi "Hastaya Çıkış" ile bağlantılı).

**[AZ]** İlaç veritabanı Azerbaycan ilaç kaydı olmalı. DDI/gebelik uyarı motoru değerli ve homunculus'un klinik zekâ vizyonuyla birebir örtüşür — korunmalı/geliştirilmeli. Eczane+hemşire onay zinciri rol modeline bağlı.

## 7. İlaç Order Şablonları (Video 7)

**Ekran:** İlaç Order ekranındaki **Şablonlar** paneli — sık verilen ilaç/order setlerini kaydetmek için.

- Sol liste: **Yeni Şablon Oluştur** + mevcut şablonlar (ör. "RUTİN", "Obezite Protip 1-5").
- Şablon oluşturma: Şablon Adı, **Bölüm**, **Kullanıcı**, paylaşım kapsamı **"Sadece Ben / Herkes"** (kişisel mi bölüm/herkese açık mı).
- Şablona ilaç kalemleri eklenir (ilaç ara → doz → veriliş yolu → sıklık → ekle); İlaç Etkileşim Uyarıları şablonda da gösterilir.
- Kaydet → "Şablon güncellendi" yeşil toast.
- **Uygulama:** şablon seç → **İşleme Dönüştür / Şablona Kopyala** → kalemler Tedavi Başlangıç Tarihi (takvim) ile hastaya order olarak yüklenir, AKİF duruma geçer.

**Mantık:** Doktor tekrarlayan ilaç setlerini bir kez tanımlar, her hastada tek tıkla uygular. Verimlilik özelliği.

**[AZ]** Şablon mantığı doğrudan taşınır; sadece ilaç verisi ve dil yerelleşir.

## 8. Konsültasyon istemi (Video 8)

**Ekran:** Muayene kartından istem/hizmet ağacındaki **Konsültasyon** kategorisi.

- Hizmet ağacı (TÜM HİZMETLER): Muayene, Laboratuvar, Radyoloji, Müşahede, Ameliyat, Yatış, Yoğun Bakım, Fizik Tedavi, Diş, Anestezi, Patoloji, **Konsültasyon**...
- Konsültasyon tipleri: Acil Konsültasyon, Servisli konsültasyon, Konsültasyon muayene, Diyetisyen konsültasyonu, uzman/dış hekim konsültasyonu, Ortez-Protez, Radyoloji, Pediatri gastroenteroloji konsültasyonu...
- İstek diyaloğu: **Bölüm** (hedef bölüm), **Doktor Seçin** (hedef hekim dropdown), **İstek Tarihi**, **Acil / Normal** öncelik, **Konsültasyon Notu** (sebep/soru, serbest metin).
- Kaydet → yeşil "Kayıt başarılı" → istem grid'inde: Konsültasyon / "Konsültasyon muayene isteği" / Uygulayan / tarih / Durum AKİF. İptal edilebilir.

**Çıktı:** Konsültasyon isteği hedef bölüm/doktorun iş listesine düşer; o hekim cevabı Video 9'daki ekrandan yazar.

**[AZ]** Tamamen dahili akış, birebir taşınabilir. Bölüm/doktor listesi yerelleşir.

## 9. Konsültasyon cevabı görüntüleme (Video 9)

**Ekran:** Sağ sidebar → **Konsültasyon** menüsü (hastanın konsültasyon listesi).

- Liste satırı: isteyen doktor + bölüm, öncelik (Normal/Acil), tarih, **durum (Cevap Bekliyor / Cevaplandı)**.
- Satır açılınca **Konsültasyon İstek** detayı: Bölüm, Doktor, İstek Tarihi, Acil/Normal, **Konsültasyon Notu** (istek metni). Konsülte edilen hekim cevabını yazıp **Değişiklikleri Kaydet**.
- Düzenle/iptal aksiyonları (İptal Nedeni listesiyle).

**Çıktı:** İsteyen hekim konsültasyon cevabını burada okur; konsültasyon zinciri (istek → cevap) tamamlanır.

**[AZ]** Dahili, birebir taşınır.

## 10. Hasta dökümanlarına erişim (Video 10)

**Ekran:** Sağ sidebar → **Dokümanlar** (hastanın tüm belge arşivi).

- Sol ağaç, **Kategori Başlı / Tarih Başlı** sekmeleri:
  - **Klinik Dokümanlar:** Hekim Dokümanları, Hemşire Dokümanları, Muayene Formları, Tanımlama Formları.
  - **Yüklenen Dokümanlar:** Pasaport, Raporlar, Patoloji, KVKK Red Formu...
- Grid: Tür, Tarih, Protokol No, Şube, Protokol Bölümü, Uygulayan/Kullanıcı. Belge türleri: Yatan Hasta Gözlem Notları, Ameliyat Raporu, Epikriz, Konsültasyon Formu, Preoperatif Değerlendirme Formu, Vital Bulgular, Hemşire Gözlem Notu, KATZ Günlük Yaşam Aktiviteleri, Basınç/Düşme Risk Değerlendirme...
- Toolbar: **Döküman Hazırla · Döküman Ekle · Döküman Listesi** + filtre/tarih (Aktif).
- PDF tıklanınca **gömülü PDF görüntüleyici** açılır (yakınlaştır/sayfa gezinme).

**Mantık:** Doktor, hastanın tüm gelişlerindeki hekim/hemşire belgelerini ve yüklenen dosyaları tek yerden görür ve okur.

**[AZ]** KVKK → Azerbaycan veri koruma mevzuatı karşılığı. Belge mantığı birebir taşınır.

## 11. Acil hastada triyaj (Video — Acil Triyaj) — KRİTİK (Acil modülü)

**Ekran:** **Acil iş listesi / triyaj panosu**. Üst sekmeler: Acil / Poliklinik / Günübirlik + tarih + Tümü + arama.

- Grid sütunları: Hasta Bilgileri, **Triyaj** (renk kodlu: **Kırmızı / Sarı / Yeşil** aciliyet), **Yeni Triyaj Ekle** (seviye atama dropdown), Özel Durum, Laboratuvar, Radyoloji, Uygulayan, **Şikayet** (ör. "ateş öksürük", "karın ağrısı"), **Kabul Saati**, Doktoru, Hemşire, Lokasyon, **Tamamlanma Saati**, **Tamamla**.
- Triyaj atama: dropdown'dan seviye (Kırmızı/Sarı/Yeşil) seç → ✓ onay. Renk satıra yansır, aciliyete göre sıralama.

**Mantık:** Acil hastaları geliş anında triyaj kategorisine ayırır (kırmızı=en acil). Doktor/hemşire kaynak yönetimi ve öncelik sırası bu panodan.

**[AZ]** Triyaj uluslararası standart (renk sistemi), birebir taşınır. Azerbaycan acil protokolüne göre seviye adları uyarlanır. Prototipte acil/triyaj modülü yok → önemli eksik.

## 12. Ameliyat istemi (Video — Ameliyat İstem) — KRİTİK

**Ekran:** Muayene kartından **Yatış / Ameliyat İstek** diyaloğu (Ameliyat sekmesi).

- Öncelik: **Acil / En Kısa Sürede / Normal**, İstem Tarihi, (Yatış sekmesinde Yatış Süresi), İstek Notu.
- **Ameliyat Bilgileri → "Yapılacak Ameliyat Ekle":** **Ameliyat Listesi** seçici — Ameliyat Grupları ağacı + Genel/Favoriler + arama; grid (Kod, SUT Kodu, Ad, Grubu). Seçilen ameliyete **Taraf (Sağ/Sol)**, Asıl Tip, Hekimler eklenir.
- **Anestezi Tipi:** Genel / Spinal / Lokal / İntravenöz / İnfiltrasyon. **Anestezist Değerlendirmesi** toggle. **Ameliyathane Kullanımı** (süre/saat). **Nüks/Revizyon**, **Protez İstiyorum**, **Özellikli Malzeme**, **Kan Ürünü istiyorum**.
- **Gerekli Orderlar / Order Yapıldı:** ilişkili **onam/işlem formları** (BGF = Bilgilendirilmiş Gönüllü Onam Formu) listesi — ameliyata özel onam formları işaretlenir.
- Ekle → istek grid'i: Talep Tip (Ameliyat), Talep Eden, Talep Tarihi, **Planlanan Ameliyat Tarihi**, Durum AKİF.

**Çıktı:** Ameliyat talebi ameliyathane planlama/yatış sürecine düşer; onam formları eklenir.

**[AZ]** SUT kodu yerine Azerbaycan ameliyat kataloğu/kodu. Onam formları yerelleşir. Ameliyat modülü prototipte yok → cerrahi branşlar için kritik.

## 13. Ameliyat raporu doldurma (Video — Ameliyat Raporu)

**Ekran:** Sağ sidebar → **Ameliyat Rapor**. "Ameliyat Raporu Oluştur" → ameliyat/işlem seç (istemden gelen).

**Rapor alanları:**
- Kayıt Tarih, Kullanıcı, **Ameliyat Tarih ve Saati**.
- **Ameliyat Ekibi** (Cerrah, Asistan, Anestezist).
- **Ameliyat / İşlem** (yapılan ameliyat).
- **Ameliyat Notu** (operatif not, uzun serbest metin).
- **Alınan Örnekler** (patolojiye gidecek numuneler, ör. "Safra kesesi").
- **Kaybedilen ve Transfüzyon Yapılan Kan Miktarı**.
- **İmplante Edilen Cihazların Kayıt Numaraları** (implant/UDI izlenebilirliği).
- **Tanılar (ICD-10)** — post-op tanılar (Protokol/Branş/Tümü, tip, taraf).
- Toolbar: **Şablon Seç / Şablonlara Ekle / Kaydet / Kaydet ve İmzala**. Sağda ameliyata özel operatif not şablonları (paylaşım: Herkes).

**Çıktı:** İmzalı ameliyat raporu belge arşivine ve epikrize girer; alınan örnekler patoloji sürecini tetikler.

**[AZ]** Klinik içerik uluslararası; implant kayıt no izlenebilirliği korunmalı. Dahili, taşınabilir.

## 14. Ayaktan hasta modülü işlemleri (Video — Ayaktan Hasta)

**Ekran:** Geliş tipine göre sekmeli liste modülü: **Acil / Poliklinik / Günübirlik**.

- Poliklinik grid sütunları: Hasta Bilgileri, Doktoru, Bölümü, Protokol No, Hizmet Adı, **Randevu Tarihi**, **Randevu Durumu (Bekliyor)**, Kabul Tarihi, Gerçekleşme Süresi, Giriş/Çıkış Saati, Lokasyon, **Hasta Gelmedi** (no-show işaretle).
- Filtreler: tarih aralığı (takvim), **Bölüm**, **Doktor** (ör. Doç. Dr. ...), hizmet arama; branş dropdown (Acil Tıp, Ağız-Diş, Aile Hekimliği, Beyin Cerrahi, Çocuk Cerrahisi...).
- Aksiyon: hastayı **kabul et** (muayeneye al) veya **gelmedi** işaretle.

**Mantık:** Ayaktan (poliklinik) hasta akışının yönetimi — randevulu hastaları kabul etme, gelmeyenleri işaretleme, bölüm/doktor bazlı görüntüleme. İş Listesi'nin ayaktan odaklı görünümü.

**[AZ]** Dahili, taşınabilir. Branş listesi yerelleşir.

## 15. Epikriz yönetimi ve yazdırma (Video — Epikriz)

**Ekran:** Muayene kartından **Epikriz** → **Epikriz Raporu** editörü.

- Zengin metin editörü (yazı tipi, kalın, liste, tablo, bağlantı ekleme). Kayıt Tarihi + Kullanıcı.
- Bölümler gelişten **otomatik dolar**: Yakınması, Fizik Muayene Bulguları, **Ameliyat Geçmişi**, Kronik Hastalıklar, **İlaç Uygulamaları**, Tanılar, **Reçete**. "Seç / Ekle" ile ek veri gömülür.
- Toolbar: **Kaydet / Kaydet ve İmzala / Yazdır**.
- **Epikriz İşlem** iş kuyruğu (iş listesinde sekme): hastalar + epikriz durumu **Bekliyor / İşlemde / Tamamlandı**; satır seç → epikriz görünür → yazdır.

**Mantık:** Epikriz, gelişin özeti; verinin tekrar yazılmadan derlenmesi esas. İmzalanır, yazdırılır, belge arşivine girer. Taburculukla birlikte zorunlu çıktı.

**[AZ]** Klinik içerik uluslararası; dahili, taşınabilir. En değerli otomasyon: epikrizin muayene/istem/ilaç verisinden otomatik derlenmesi.

## 16. Footer (alt bar) favori işlemleri (Video — Footer Favori)

**Ekran:** Muayene kartının hızlı işlem ızgarası + alt **footer** çubuğu.

- İşlem ızgarasındaki her aksiyonun (Tetkik İstem, İlaç Reçetesi, Hizmet/Diyet/Bakım İstem, İstem Şablonları, Ameliyat/Yatış İstem, Epikriz, Çıkış Yazdırma, Medula Raporları, Konsültasyon, Transfer İstem...) yanında **yıldız** var.
- Yıldızlanan işlem, kartın **alt footer çubuğuna** kısayol ikonu olarak eklenir → tek tıkla erişim.
- Doktor en sık kullandığı aksiyonları kişiselleştirerek footer'a sabitler.

**Mantık:** Kişiye özel hızlı erişim; iş akışını hızlandıran küçük ama etkili verimlilik özelliği.

**[AZ]** Birebir taşınır (kullanıcı tercihi olarak saklanır).

## 17. Hasta kartına / yeni muayene kartına erişim (Video — Hasta Kartına Erişim)

**Ekran:** İş Listesi → hasta satırı → **Görevine Git / Görüntüle** (çift tık) → o protokolün **Muayene Kartı** açılır.

- İş listesinden tek hareketle muayene kartına geçiş (yeni geliş için yeni muayene kartı).
- Kartın alt footer kısayolları ve sağ sidebar modül menüsü hazır gelir.

**Mantık:** Doktorun iş listesinden muayeneye giriş kapısı; Bölüm 1 ve 5'in birbirine bağlanması. (Ayrı yeni bir ekran değil; navigasyon.)

**[AZ]** Navigasyon kalıbı taşınır.

## 18. Hasta bilgileri / yatış / protokol / uyarılar / fiziksel ölçümler (Video)

**Ekran:** Muayene kartı başlığındaki hasta adı menüsünden açılan alt paneller.

- **Hasta Bilgileri:** Genel Bilgiler (hasta no, kimlik, doğum, uyruk, kan grubu, dil...), **Hasta Yakınları** (next of kin), **Refakatçi Bilgileri**.
- **Yatış Tarihçesi:** grid — İşlem (Servis Kabulü / Güncelleme), Protokol No, Uygulayan, Yatış Kodu, Eski/Yeni Yatış Durumu, **Kat/Yatak**, Giriş/Çıkış Tarihi (yatak-servis hareketleri).
- **Hasta Uyarıları (klinik risk bayrakları):** renkli ikon şeridi — **Düşme, Bası (yara), Temas/İzolasyon, CPR, Diyabet, Alerji, Kısıtlama, Nötropeni, Solunum, Aç (NPO), İzole, Pika, Sarı kod...** Uyarı + tarih ekle.
- **Fiziksel Ölçümler:** Boy/Kilo/VKİ, Ateş, Nabız, Tansiyon, SPO2 (antropometri + vital giriş).

**Mantık:** Doktor hastanın kimlik/yakını, yatak hareketi, güvenlik uyarıları ve ölçümlerini tek başlıktan görür/düzenler. **Hasta uyarıları** klinik güvenlik için kritik (düşme/alerji/izolasyon bayrakları).

**[AZ]** Uyarı bayrakları uluslararası güvenlik standardı — korunmalı, homunculus klinik güvenlik vizyonuyla örtüşür. Dahili, taşınabilir.

## 19. Hasta geliş bilgisi görüntüleme (Video — Tüm Gelişler)

**Ekran:** Sağ sidebar → **Tüm Gelişler** (hastanın tüm geliş/protokol geçmişi).

- Her geliş satırı: Doktor, Bölüm (ör. Anestezi ve Reanimasyon, Acil Tıp), **geliş tipi** (Ayaktan/Yatan), tarih, protokol no.
- Filtre: **Doktor / Bölüm** sekmeleri; **Tümünü Aç** (hepsini genişlet). Satır açılınca gelişin detayı.

**Mantık:** Doktor, karttan çıkmadan hastanın farklı bölümlerdeki geçmiş ve güncel gelişlerini görüp geçmişe erişir. Hasta öyküsü/süreklilik için önemli.

**[AZ]** Dahili, taşınabilir.

## 20. e-Nabız bilgilerine erişim (Video — e-Nabız) — TR'YE ÖZGÜ, UYARLAMA ŞART

**Ekran:** Footer'daki **e-Nabız** düğmesi → **e-Nabız / "Hekim İçin Giriş Seçenekleri"** portalı (Türkiye Sağlık Bakanlığı ulusal kişisel sağlık kaydı).

- "Verilere erişebilmek için kişi doğrulaması gerekmektedir" + **E-Devlet Girişi Yap** / **Eczane İle Giriş Yap** butonları.
- Amaç: hastanın başka kurumlardaki ilaç/tahlil/görüntü/geçmiş kayıtlarını ulusal sistemden çekmek.

**[AZ] ÖNEMLİ:** e-Nabız ve e-Devlet **Türkiye'ye özgüdür, birebir alınmaz.** Azerbaycan karşılığı **TƏBİB / e-tabib / mygov** (ulusal sağlık kayıt sistemi). Entegrasyon varsa oraya bağlanır; yoksa bu buton prototipte olmaz. Hasta doğrulama akışı (ASAN imza vb.) Azerbaycan'a göre tasarlanır.

## 21. Hastaya ait randevular görüntüleme (Video — Randevular)

**Ekran:** Sağ sidebar → **Randevular** (hastanın randevu listesi).

- Grid: **Randevunun Bölümü**, **Randevunun Hizmeti**, Doktor, **Randevu Durumu** (Bekliyor), **Randevu Tarihi**, Randevu Şubesi, Protokol No.

**Mantık:** Doktor karttan çıkmadan hastanın mevcut/gelecek randevularını görür (ör. istediği tetkikin randevusu geldi mi).

**[AZ]** Dahili, taşınabilir.

## 22. Laboratuvar / radyoloji sonuç ve görüntüleri (Video) — KRİTİK

**Ekran:** Sağ sidebar → **İşlem → Laboratuvar / Görüntüleme / Patoloji**. Üst sekmeler: **Laboratuvar · Saç · Patoloji · Görüntüleme · Vital Bulgular · Sx İstem · Klinik Formlar** + tarih aralığı + **PACS** butonu.

- **Laboratuvar Sonuçları:** satır = test (C-Peptid, SARS-Cov2 IgG/IgM, Kreatinin, eGFR, Hemogram/WBC/RBC/HGB/HCT, ALT, AST, Glukoz, HbA1c, Gamma GT...), **sütun = tarih** → aynı testin zaman içindeki **trendi** yan yana. **Anormal değerler kırmızı/pembe vurgulu**. Gruplar genişletilebilir, birim gösterilir.
- **Görüntüleme Sonuçları:** test (US Tüm Abdomen, Akciğer P-A...) + tarih sütunları + ikon ile **rapor/görüntü aç** → **Rapor görüntüleyici** (radyoloji raporu PDF: Teknik / Bulgular / Sonuç). **PACS** entegrasyonu ile görüntülere erişim.

**Mantık:** Doktorun sonuç inceleme merkezi: lab trendi tek tabloda, anormaller renkli; radyoloji raporu + PACS görüntüsü. Karar vermenin ana veri kaynağı.

**[AZ]** Klinik içerik uluslararası; referans aralıkları/birimler yerel laboratuvara göre. PACS entegrasyonu Azerbaycan radyoloji sistemine bağlanır. Trend tablosu + anormal vurgu korunmalı (homunculus klinik zekâ için değerli). Prototipte sonuç görüntüleme eksik → yüksek öncelik.

## 23. Medula Raporları yazma (Video — Medula Raporu) — TR'YE ÖZGÜ, UYARLAMA ŞART

**Ekran:** Hızlı ızgara → **Medula Raporları** → **Yeni Rapor** → **Yeni Medula Raporu** formu (SGK ilaç/sağlık kurulu raporu).

- **Rapor Bilgileri:** hasta/TC/protokol, **Rapor Tipi** (İlaç / Sağlık Kurulu...), **Düzenleme Tipi** (Tek Hekim / Sağlık Kurulu), Belge No, **Rapor Medula Durumu** ("Medula'ya gönderilecek"), Veriliş/İlk Rapor Tarihi, Başlangıç/Bitiş, **Süre** (ör. 365 gün), Klinik Tanı, Özel Durum.
- **Doktor(lar):** Ad, Branş Kodu, Tescil No, TC, Sertifika Kodu, Onay Durumu (tek hekim veya kurul üyeleri) — Bölüm/Doktor ekle.
- **Tanılar (ICD-10):** Birincil / Ana Tanı / Kesin Tanı + Taraf; **Teşhis Seçimi** (TEŞHİS LİSTESİ → SEÇİLEN TEŞHİS).
- **Etken Madde** (ilaç raporunda): Etken Madde Adı/İçeriği, Günde Kaç Kez, **Doz**, **Kullanım Periyodu**.
- **Teşhise Bağlı Tanılar**, Rapor Ek Açıklama, Şablon Seç/Ekle. **Kaydet / Kaydet ve Gönder** (Medula'ya) → "Kayıt başarılı".

**[AZ] ÖNEMLİ:** Medula = Türkiye SGK sistemi. Azerbaycan karşılığı **SAMHI / İcbari Tibbi Sığorta** raporlama. Rapor tipleri, tescil/sertifika kavramları, Medula'ya gönderim **birebir alınmaz**; Azerbaycan geri ödeme/rapor mevzuatına göre yeniden tanımlanır. Rapor yapısı (tanı + etken madde + doz + süre + kurul) genel mantık olarak korunabilir.

## 24. Parametre Tarihçesi aktarma + şablon kaydetme (Video)

**Ekran:** Muayene kartındaki her alanın (Yakınması/Öykü/Şikayet vb.) yanındaki küçük ikonlar.

- **Parametre/Öykü Tarihçesi:** o alanın önceki gelişlerdeki değerlerini listeleyen popup (tarih + kullanıcı + metin) → **aktar** ile eski bir değeri güncel alana kopyala.
- **Şablona Kaydet / Şablon Listesi:** alanın metnini **şablon** olarak kaydet ("Yeni Şablon" → ad → **Genel/kişisel** → Ekle); sonra "Şablon Listesi"nden seç/uygula, Düzenle. Yeşil "Şablon Kayıt Edildi".

**Mantık:** Alan bazında verimlilik — doktor önceki muayeneden metni taşır veya sık yazdığı metni şablonlaştırır. Tekrarı azaltır.

**[AZ]** Birebir taşınır (şablonlar kişisel/genel saklanır). Not: "parametre tarihçesi aktarma" ile bir sonraki videodaki "tarihçeden aktarma" ve "istem tarihçesi" aynı aileden (geçmiş veriyi tekrar kullanma) özelliklerdir.

## 25. Patoloji sonucu görüntüleme (Video — Patoloji)

**Ekran:** Sağ sidebar → İşlem → sonuç görünümü **Patoloji** sekmesi (Laboratuvar/Saç/**Patoloji**/Görüntüleme/Vital Bulgular/Sx İstem/Klinik Formlar).

- **Patoloji Sonuçları** tablosu: Test Adı + patoloji raporu metni (makroskopik/mikroskopik bulgular, serbest metin).
- Zaman filtresi: Son 24 Saat / Son 1 Hafta / Son 1 Ay / Son 3 Ay / Tarih Aralığı / Tümü; kapsam Protokol/Tümü.

**Mantık:** Ameliyat/işlemden alınan örneklerin patoloji sonuçları doktora döner; doktor burada okur (Ameliyat Raporu "Alınan Örnekler" ile bağlantılı).

**[AZ]** Dahili, taşınabilir.

## 26. Randevu yönetimi (Video — Randevu Yönetimi)

**Ekran:** İş listesi üst sekmesi **Randevular** + **Ajanda** (takvim) görünümü.

- **Randevu listesi:** Hasta, **Randevu Bilgileri** (Randevu T. + Kabul T.), Şube, **Gecikme Süresi** (ör. K.Gecikme +4 saat), Bekleme Süresi, İşlem (Ameliyat/Radyoloji), durum **Bekliyor**.
- **Ajanda:** **Gün / Hafta** takvimi; saat/gün ızgarasında randevu slotları renk kodlu — mavi=dolu randevu, gri=kapalı (**Kapalı-Toplantı / Kapalı-İzin / Kapalı-Ameliyat**). Haftalık görünüm tüm günleri gösterir.

**Mantık:** Doktor randevu kuyruğunu + kişisel takvimini yönetir: randevuları görür, gecikmeyi izler, meşgul/kapalı zaman dilimlerini (izin, toplantı, ameliyat) ayarlar.

**[AZ]** Dahili, taşınabilir. Takvim/ajanda prototipte muhtemelen eksik → poliklinik randevu düzeni için gerekli.

## 27. Taburculuk istemi (Video — Taburculuk İstem)

**Ekran:** Muayene kartından **Taburculuk İstemi** diyaloğu (yatan hasta).

- **Taburculuk Tipi / sonucu:** Aile hekimliği bakımında eve gönderme, Aynı/Daha kapsamlı hastaneye sevk, Diğer-Eve gönderme, **Şifa ile taburcu**, **Tedavi ile taburcu**, Tedaviden vazgeçme, **Vefat**... + **Taburcu Tarihi** + Açıklama.
- **Bekleyen İstemler** grid: taburculukta hâlâ açık order'lar (Diyet/ilaç...) + Tedavi Bitiş Tarihi + Durum AKİF (taburcudan önce kapatılacaklar görünür).
- Kaydet → "Taburculuk işlemi gerçekleşti" → **Taburculuk/Transfer** listesinde: Talep Tipi, Talep Eden, **Taburcu Tip**, Yatış Tarihi, **Planlanan Taburculuk Tarihi**, Durum.

**Çıktı:** Taburculuk talebi hemşire/servise düşer; bekleyen order kontrolü yapılır; epikriz + reçete ile süreç tamamlanır.

**[AZ]** Taburculuk sonuç tipleri Azerbaycan mevzuatına göre yerelleşir. Dahili akış taşınabilir. Yatan/taburculuk modülü prototipte eksik.

## 28. Takip ekranı yönetimi (Video — Takip) — KRİTİK (yatan/yoğun bakım)

**Ekran:** Sağ sidebar → **Takip** — yatan hastanın bütünleşik **tedavi takip çizelgesi (flowsheet / zaman ızgarası)**. (Örnek hasta Çocuk Sağlığı/yenidoğan.)

- **Sol kolon:** hastanın tüm aktif order'ları — diyet (özel tıbbi amaçlı diyet gıda), vitaminler, IV/IM antibiyotik (GENTA, PENBİSİN), CRP, Hemogram, TSH, Hemşire Gözlem Notu...
- **Sağ:** **zaman ızgarası** (üstte saat/gün); her order'ın her hücrede uygulama/numune/gözlem işareti (renkli ikon) = **eMAR / flowsheet** — ilacın ne zaman verildiği, tahlilin ne zaman alındığı.
- **Durum renkleri (üst filtre):** Eczane Onayında, Hemşire Onay Bekliyor, Uygulama Bekliyor, **Uygulandı**, Pas Geçildi, Reddedildi, Durduruldu.
- Hücre tıklanınca uygulama detayı: İstek Yapan, Planlı, Eczacı, Uzman Hemşire, Planlanan/Uygulanan Saat, durum değişimleri, hemşire notu.
- Order sağ-tık: Protokol Barkodu Yazdır, Diğer Uygulamalar...

**Mantık:** Doktor + hemşire için yatan hasta tedavisinin tek ekranda zaman ekseninde izlenmesi: ne verildi, ne bekliyor, ne atlandı. İlaç Order (Video 6) ve Takip, eczane+hemşire onay zinciriyle birbirine bağlı.

**[AZ]** Klinik/eMAR mantığı uluslararası, korunmalı — homunculus'un yoğun bakım/yenidoğan (ICU/NICU) vizyonuyla doğrudan örtüşür. Prototipte yok → yatan/yoğun bakım için en kritik eksiklerden.

## 29. Tarihçeden Aktarma (Video — Tarihçeden Aktarma)

**Ekran:** Muayene kartı toolbar → **Tarihçe** → **Döküman Tarihçesi**.

- Grid: hastanın önceki muayene dökümanları (Döküman, **Oluşturan Kullanıcı** = doktor, İmzalı, İnceleme Tarihi, Oluşturma Tarihi) — farklı gelişler ve versiyonlar.
- Bir önceki dökümanı seç → **Aktar** → o muayenenin **tüm içeriği** güncel karta kopyalanır. Kapsam: AKİF Protokol / Hasta.

**Mantık:** Alan bazlı aktarmanın (Bölüm 24) toplu versiyonu — önceki muayenenin tamamını tek tıkla getirip üzerinde düzenleme. Kronik/kontrol hastalarında büyük zaman tasarrufu.

**[AZ]** Birebir taşınır.

## 30. Tetkik isteminde favori şablonlar (Video — Tetkik Favori Şablon)

**Ekran:** İstem (order) ekranındaki sol **Favoriler** paneli.

- **Favori grubu/klasörü oluştur:** düzenle → grup adı ver (ör. "RUTİNLER 2") → Ekle. Gruplar Laboratuvar/Radyoloji altında birikir, iç içe olabilir.
- **Gruba tetkik ekle:** katalogdan testleri **yıldızla** (favori) → seçilen gruba girer. "Favorilere Eklendi" yeşil toast.
- Her grup = tekrar kullanılabilir **tetkik order seti** (ör. "Çocuk Kan Hastalığı", "Çocuk Rutin").

**Mantık:** İlaç order şablonlarının (Bölüm 7) tetkik/lab/radyoloji karşılığı — sık istenen test setlerini bir kez kurup tek tıkla uygulama.

**[AZ]** Birebir taşınır; test verisi yerelleşir. Favori/şablon mekanizması tüm modüllerde tekrar eden ortak kalıp.

## 31. Tıbbi İkinci Görüş (MSO) hastalarına erişim (Video)

**Ekran:** İş listesi üst sekmesi **Tıbbi İkinci Görüş** → hasta seç → sağ sidebar **Görevler → MSO** paneli.

- **MSO Talep Bilgileri:** Hasta Özeti, (VM Portal bağlantısı — hasta portalı).
- **Dışarıdan Yüklenen Dosyalar:** hastanın uzaktan yüklediği dosyalar (PDF vb.) + Yeni Ekle.
- **Diğer Hekimlerin MSO'ları:** başka hekimlerin aynı vaka için ikinci görüşleri.
- **MSO:** Hekim Notu grid (Hekim, Gönderim Tarihi, **MSO Durumu = Cevaplandı**); doktor **Hekim Notu** (görüşünü) yazar → **Yorum Yap / Gönder**.

**Mantık:** Uzaktan **tıbbi ikinci görüş** (telemedicine): hasta/başka kurum belge yükler, hekim inceleyip görüş yazar; diğer hekimlerin görüşleri de görülür.

**[AZ]** "VM Portal" MLP markasına özgü; hasta portalı/telemedicine Azerbaycan'a göre uyarlanır. Özellik mantığı taşınabilir ama öncelik düşük (temel klinik akışlardan sonra).

## 32. Yatan Hastalar görüntüleme (Video — Yatan Hastalar) — KRİTİK (yatan/NICU)

**Ekran:** **Yatan hasta listesi** (servis/kat bazlı roster).

- Sütunlar: Cinsiyet, H.No, Hasta (ad + yaş), **Tanı**, Doktoru, Y.No, **Yatak** (ör. "205 Hasta Yatağı", **Kuvöz**, Bebek Bakım), **Yatış Tarihi**, **Planlanan Taburculuk Tarihi**, Durumu.
- Filtreler: durum (Yük/Yatış Bekliyor, **Tab. Bekliyor**, Tab. Edildi), **Kat** (ör. 1. Kat +22, 1. Kat Bebek Odası, Yenidoğan Yoğun Bakım, Medikal Onkoloji...), **Bölüm**, kapsam **Benim Hastalarım / Bölümün / Tüm hastalar**, görünüm (liste/pano).
- Yenidoğan/NICU servisleri (Bebek ... + Kuvöz) ayrı görünür.

**Mantık:** Doktorun yatan hasta panosu: kim nerede yatıyor, tanısı, yatış/planlanan taburcu tarihi, taburcu bekleyenler. Servis vizit yönetiminin temeli.

**[AZ]** Dahili, taşınabilir. **NICU/kuvöz servis desteği** homunculus'un yenidoğan vizyonuyla örtüşür — korunmalı. Prototipte yatan hasta modülü yok → yüksek öncelik.

## 33. Yatan hasta gözlem notu (Video — Gözlem Notu) — KRİTİK (yatan)

**Ekran:** **Yatan Hasta Gözlem Notları** — günlük ilerleme notları zaman çizelgesi.

- Doktor **Yatan Hasta Gözlem Notları** ile **Hemşire Gözlem Notları** yan yana, tarihli; her not: Hastanın Durumu + bakım aktiviteleri + "Hemşirelik Bakım Planları görüldü/onaylandı: Evet".
- **Yatan Hasta Gözlem Notu Ekle → Günlük Gözlem Notu** formu: Kayıt Tarihi, Kullanıcı, **Hastanın Durumu**, **Plan** (SOAP benzeri), **Tanılar (ICD-10)**. Sol nav: Günlük Gözlem Notu, Tanılar, **Ağrı Değerlendirme**, Basamak/Sepsis Durum...
- Şablon Seç/Ekle, **Kaydet / Kaydet ve İmzala**.

**Mantık:** Yatan hastada günlük vizit notu (durum + plan), hekim-hemşire notlarının birlikte izlenmesi, bakım planı onayı. Yatan takibin klinik belgesi.

**[AZ]** Klinik içerik uluslararası; dahili, taşınabilir. Ağrı/sepsis/risk değerlendirmeleri homunculus klinik skorlama vizyonuyla örtüşür. Prototipte yok → yatan modülü için gerekli.

## 34. Yatış istemi (Video — Yatış İstek)

**Ekran:** Muayene kartından **Yatış / Ameliyat İstek** diyaloğu, **Yatış** sekmesi (Ameliyat istemiyle aynı diyalog).

- Yatış tipi sekmeleri: **Yatış / Ameliyat / Yoğun Bakım / Medikal Yatış**.
- Alanlar: öncelik (Acil / En Kısa Sürede / Normal), **Yatış Tarihi**, **Yatış Süresi** (gün), İstek Notu.
- **Gerekli Orderlar / Order Yapıldı:** ilgili onam/işlem formları (BGF).
- Kaydet → "Kayıt başarılı, istem tamamlandı" → istek grid'i: Talep Tip (Yatış), Talep Eden, Talep Tarihi, **Planlanan Yatış Tarihi**, Durum AKİF.

**Çıktı:** Yatış talebi yatak/servis yönetimine düşer; hasta yatan listesine (Bölüm 32) girer, takip (Bölüm 28) başlar.

**[AZ]** Dahili, taşınabilir. **Yoğun Bakım** yatış tipi NICU/ICU için önemli. Yatış modülü prototipte yok → yüksek öncelik.

## 35. İstem tarihçesi ve protokol işlemleri (Video)

**İki ekran** (sağ sidebar):

**İstem Tarihçesi** — tüm istemlerin denetim izi:
- Grid: İstem Tip (İlaç/Diyet/Hizmet/Tetkik/Konsültasyon/Patoloji/Laboratuvar/Ameliyat/Kan/Bakım), İstem Bilgisi, Uygulayan, İstem Tarihi, Tedavi Baş/Bit, **İstem Durumu** (AKİF/Tamamlandı/Durduruldu).
- Filtreler: İstem Tip, İstem Durumu, tarih aralığı, kapsam AKİF Protokol/Hasta.

**Protokol İşlem** — protokole işlenen hizmet/malzemeler (klinik-mali köprü):
- Grid: İşlem Tarihi, Hizmet/Malzeme Adı, **Durum** (İşlemde/İade/Tamamlandı), Hizmet/Malzeme Tipi, Birim, Adet, Yapan Doktor, Kullanıcı (ör. ameliyat ilaç/malzemeleri: METOKLOPRAMİD, SUPRANE, SEFAZOL, PROPOFOL...).
- Toolbar: **Hastaya Çıkış · İade · Listele**.

**Mantık:** Doktor verdiği tüm istemleri tek listede denetler; protokole yansıyan hizmet/malzeme (faturaya giden) kalemlerini görür, gerekirse hastaya çıkış/iade yapar. **Doktor istemi → vezne faturası** köprüsü burada (Vezne analizi "İstek Havuzu / İşlem Havuzu" ile eşleşir).

**[AZ]** Dahili, taşınabilir. Mali tarafta SGK yerine SAMHI/İcbari Sığorta payı mantığı (Vezne analizine bakılır).

---

## 36. Doktor rolünün tekrar eden kalıpları (özet)

| Kalıp | Nerede |
|-------|--------|
| **İş listesi → protokol seç → muayene kartı** giriş kapısı | Her yerde (1, 2, 17) |
| **Sağ sidebar modül menüsü** (Gelişler, İşlem, Lab/Görüntüleme, Patoloji, Konsültasyon, Dokümanlar, Takip, Randevular…) | Muayene kartı (5) |
| **İstem (order) ağacı + favori/şablon** | Lab/Radyoloji (3,30), İlaç (6,7), Hizmet/Konsültasyon (8) |
| **Kaydet / Kaydet ve İmzala** (imzalı kilit) | Muayene, epikriz, ameliyat raporu, gözlem notu |
| **Şablon (kişisel/genel) + Tarihçeden/alandan aktarma** | 5,7,24,29,30 |
| **İstem iptali: neden seçimli** | 3,8,9 |
| **Durum makinesi:** AKİF → Tamamlandı/Durduruldu/Reddedildi/İptal | Tüm order'lar |
| **Onay zinciri:** istem → eczane onayı → hemşire uygulaması | İlaç order + Takip (6,28) |
| **Klinik güvenlik:** hasta uyarı bayrakları, DDI/gebelik uyarısı, triyaj renk | 6,11,18 |

## 37. Doktor nesne/durum makineleri (özet)

| Nesne | Durumlar |
|-------|----------|
| Muayene kartı | Taslak → Kaydedildi → İmzalandı (kilit) |
| İş listesi hastası | Bekliyor → İşlemde → Tamamlandı |
| Order (istem) | AKİF → Tamamlandı / Durduruldu / Reddedildi / İptal (nedenli) |
| İlaç order (uygulama) | Eczane Onayında → Hemşire Onay Bekliyor → Uygulama Bekliyor → Uygulandı / Pas Geçildi / Reddedildi / Durduruldu |
| Konsültasyon | İstek → Cevap Bekliyor → Cevaplandı |
| Talep (Yatış/Ameliyat/Taburculuk/Transfer) | AKİF → Planlandı → Gerçekleşti |
| Epikriz | Bekliyor → İşlemde → Tamamlandı (imzalı) |
| Acil triyaj | Kırmızı / Sarı / Yeşil → Tamamlandı |
| Yatan hasta | Yatış Bekliyor → Yatan → Taburculuk Bekliyor → Taburcu |
| Medula raporu [AZ: SAMHI] | Taslak → Medula'ya Gönderilecek → Gönderildi |

---

## 38. HOMUNCULUS PROTOTİPİNDE DOKTOR ROLÜ İÇİN EKSİK EKRAN/AKIŞLAR (öncelik sırasıyla)

> Prototip saf statik HTML/JS ve doktor modülü büyük ölçüde yok. Aşağıdaki liste,
> referans sistemin doktor akışına göre kurulması gereken ekranları önem sırasıyla verir.
> `[AZ]` = Türkiye'ye özgü, Azerbaycan'a (SAMHI/TƏBİB) uyarlanacak.

### Öncelik 1 — Çekirdek (bunlar olmadan doktor modülü çalışmaz)
1. **Muayene Kartı** (Bölüm 5): üç kolonlu anamnez + fizik muayene + ICD-10 tanı + izlem/plan; Kaydet/İmzala; şablon ve tarihçeden aktarma. **En büyük eksik.**
2. **Doktor İş Listesi** (Bölüm 1,2): bekleyen/randevulu hasta kuyruğu, durum ve lab/radyoloji sayaçları, hasta arama, protokolden muayeneye geçiş.
3. **İstem (Order) ekranı — Lab + Radyoloji** (Bölüm 3): katalog ağacı + favori + öncelik + iptal nedeni; sonuç geri dönüşü.
4. **Lab/Radyoloji sonuç ve görüntü inceleme** (Bölüm 22): tarih trendli lab tablosu + anormal vurgu + radyoloji raporu/PACS.
5. **Reçete / ilaç yazımı** (Bölüm 4 + 6): dahili reçete (tanı + ilaç + doz + yazdır) ve/veya ilaç order; DDI/gebelik uyarı motoru. `[AZ: e-reçete-TR kaldırılır]`

### Öncelik 2 — Yatan hasta / akut bakım (homunculus ICU-NICU vizyonu için şart)
6. **Yatış istemi + Yatan Hasta Listesi** (Bölüm 32,34): servis/kat/kuvöz roster, yatak, planlanan taburcu; **Yoğun Bakım/NICU** desteği.
7. **Takip (tedavi flowsheet / eMAR)** (Bölüm 28): zaman ekseninde ilaç-lab-vital-gözlem + eczane/hemşire uygulama durumu.
8. **Yatan hasta gözlem notu** (Bölüm 33): günlük durum+plan, ağrı/risk değerlendirme, hemşire-hekim notu birlikte.
9. **İlaç Order + şablonları + onay zinciri** (Bölüm 6,7): doz hesabı, veriliş yolu, sıklık, DDI uyarısı, eczane→hemşire onayı.
10. **Taburculuk istemi** (Bölüm 27): sonuç tipi + bekleyen order kontrolü. `[AZ: tipler yerelleşir]`

### Öncelik 3 — Cerrahi ve tanısal destek
11. **Ameliyat istemi + Ameliyat Raporu** (Bölüm 12,13): ameliyat seçimi/taraf/anestezi/onam; operatif not + örnek + implant no + post-op tanı.
12. **Konsültasyon istek + cevap** (Bölüm 8,9): bölüm/doktor yönlendirme, öncelik, not; cevap okuma.
13. **Patoloji sonucu görüntüleme** (Bölüm 25).
14. **Epikriz** (Bölüm 15): gelişten otomatik derlenen imzalı özet + yazdır.
15. **Dokümanlar arşivi** (Bölüm 10): klinik/yüklenen belgeler + PDF görüntüleyici.

### Öncelik 4 — Acil ve ayaktan yönetim
16. **Acil triyaj panosu** (Bölüm 11): renk kodlu triyaj, şikayet, aciliyet sıralaması. `[AZ: Azerbaycan acil protokolü]`
17. **Ayaktan/poliklinik listesi + randevu yönetimi/ajanda** (Bölüm 14,21,26): kabul, gelmedi, günlük/haftalık takvim, kapalı zamanlar.

### Öncelik 5 — Verimlilik ve destek (sonraya bırakılabilir)
18. **Şablon ve favori altyapısı** (Bölüm 7,24,29,30): tüm modüllerde kişisel/genel şablon, alan ve tüm-muayene aktarma, footer favori (Bölüm 16).
19. **Hasta başlığı alt panelleri** (Bölüm 18): kimlik/yakın/refakatçi, yatış tarihçesi, **hasta uyarı bayrakları** (düşme/alerji/izolasyon), fiziksel ölçümler.
20. **İstem tarihçesi + Protokol İşlem** (Bölüm 35): order denetim izi + faturaya giden hizmet/malzeme (vezne köprüsü).
21. **Tıbbi İkinci Görüş / telemedicine** (Bölüm 31) — en düşük öncelik.

### Türkiye'ye özgü, BİREBİR ALINMAYACAK (Azerbaycan karşılığı kurulacak) `[AZ]`
- **e-Nabız / e-Devlet** (Bölüm 20) → **TƏBİB / e-tabib / mygov**, ASAN imza ile doğrulama.
- **Medula e-reçete / "Reçetem"** (Bölüm 4) → Azerbaycan reçete akışı / ulusal e-reçete (varsa).
- **Medula Raporları** (Bölüm 23) → **SAMHI / İcbari Tibbi Sığorta** rapor/geri ödeme akışı; tescil/sertifika kavramları yerelleşir.
- **SGK pay ayrışması** (Bölüm 35, vezne köprüsü) → SAMHI/İcbari Sığorta pay mantığı.
- **SUT kodları** (ameliyat/hizmet) → Azerbaycan hizmet kodları.
- Markasal: "VM Portal", "nabız" vb. → kendi kimliğimiz.

---

## 39. Doğrulanamayan / canlı sistemden teyit gerektiren noktalar
- Küçük yazı tipli alanların bir kısmı kare çözünürlüğünde net okunamadı (favori grup adları, bazı dropdown içerikleri); mantık doğru ama birebir etiketler canlı sistemden teyit edilmeli.
- Order ekranındaki "Planla" düğmesinin tam davranışı (randevuya mı çevirir).
- İlaç Order'daki eczane onay akışının eczacı tarafı (bu videolarda doktor tarafı görüldü).
- Medula/SAMHI gönderim durum değerlerinin tam listesi.
- "Sx İstem" ve "Saç" sekmelerinin tam içeriği (sonuç görünümünde).
