# Vezne Süreç Analizi — 17 Eğitim Videosundan

> Kaynak: Pusula HBYS (MLP Care, sürüm 1.2.5.5) vezne eğitim videoları 1–17.
> Bu belge referans sistemin vezne akışını birebir karelerden çıkarır. Amaç: kendi
> HBYS'mizin (asbadef prototipi, Azerbaycan pazarı) vezne + kayıt açma süreçlerini
> buna göre yeniden kurmak. Ekran adlarını birebir KOPYALAMIYORUZ — mantığı alıyoruz,
> kendi Azerice adlarımızı/görsel kimliğimizi kullanıyoruz, Medula yerine SAMHI/TƏBİB.
>
> Son güncelleme: 2026-10-25

---

## 0. Üç katmanlı çekirdek mantık (her şeyin temeli)

**Hasta → Protokol (Geliş) → İşlem** üç katman:

1. **Hasta kartı** kalıcıdır (bir kere açılır, hep kalır). Durumu: **Ön Kayıt** / **Kesin Kayıt** (+ Gizli Hasta bayrağı).
2. Her hastane gelişi bir **Protokol** açar (= bizim "kayıt açma"). Protokolün kurumu,
   bölümü, doktoru, geliş tipi, protokol tipi vardır. Durumu: Açık / Kapalı / İptal / Birleştirilmiş.
3. Her protokole **İşlem** eklenir: hizmet, ilaç/malzeme, tetkik, ameliyathane. Her
   işlemin tutarı **HASTA payı** ve **KURUM (SGK/sigorta) payı** olarak ayrışır.

Not, dosya, avans, indirim her yerde **hastaya mı protokole mi** bağlı ayrımını taşır.
Zorunlu alanlar kırmızı etiketlidir.

---

## 1. Giriş ve ana yapı (Video 1)

- Login: Hastane + Kullanıcı + Şifre + **Şube** seçimi (çok şube/çok hastane yapısı).
- Vezne çalışanının ana giriş noktası: **Vezne Paneli**.
- Vezne Paneli sağ kenar menüsü iki grup:
  - **Vezne 360:** Hasta Arama, Randevu Arama, Son Hastalar, Fiyat Verme, Dönem Bilgileri, (Reçete Listesi).
  - **Vezne İş Havuzu:** Evrak Takip, Ödeme Takip, GFK Takip, Onam Formları, Onay Bekleyen İndirimler, Onay Bekleyen İadeler, İade Taleplerim, Medula, Toplu Fatura İşlemleri, Randevulanacak Hizmetler, Onay Bekleyen Protokoller.
- Sağ üst başlık: kullanıcı, **Banko**, **Dönem No**, Tarih (vezne hep bir bankoda ve açık bir dönemde çalışır).

---

## 2. Hasta arama + hasta kartı (Video 2)

**Akış:** Hasta Arama → kriter → Listele → kayıt yoksa "Yeni kayıt açmak ister misiniz?" → Evet/Ekle → Hasta Kartı doldur → Kaydet.

**Hasta Arama kriterleri:** Kimlik No, Adı, Soyadı, Baba Adı, Anne Adı, Hasta No, Kart No, Pasaport No. Detay: Protokol No, Bölüm, Doktor, Tarih aralığı.
Sonuç grid: **Durum (Ön/Kesin Kayıt)**, Hasta No, Kimlik No, ad-soyad, baba/anne, doğum tarihi, SGK, ÖSS, AK, telefon, pasaport.

**Hasta Kartı sekmeleri:** Hasta Kartı · Gelişler · Faturalar · Ödemeler/Avanslar · İndirimler · Dosyalar/Resimler · Notlar.
Araç çubuğu: Kaydet · **Hasta Kabul** · Diğer · Yazdır.

Hasta Kartı alan blokları:
- **Genel:** Hasta No/Tipi, Uyruk/Pasaport, **Kimlik No** (zorunlu), **Ad/Soyad** (zorunlu), **Cinsiyet/Doğum** (zorunlu, yaş otomatik), **Baba Adı** (zorunlu), Anne Kimlik/Ad/Soyad (zorunlu), Özel Kart/Sicil, Bizde Doğan, Vefat.
- **İletişim:** Cep (zorunlu), Ev/İş tel, e-posta, fax, SMS/Mail izni (E/H).
- **Ev/İş Adresi:** Ülke, İl/İlçe, Adres, Posta kodu.
- **Diğer:** İletişim dili, engel, gelir, meslek, eğitim, kan grubu, plaka, **KVKK izni** (E/H).
- **Kurum:** SGK, SGK Medula tipi (Çalışan/Emekli), Özel Sigorta, Anlaşmalı Kurum, İndirim Grubu, İndirim Personel/Açıklama.
- **Kimlik:** tip, il/ilçe, seri no, doğum yeri, medeni hal.

**Gelişler sekmesi:** sol = protokol listesi (tarihe gruplu); sağ = seçili protokolün detayı bölümlerle: Kurum Bil. / Hekim / Yatış / Takip Bil. / Geliş Bil. / Yurtdışı / Referans. Protokol araç çubuğu: Kaydet, Düzenle, **Durum** (Kapat/Birleştir/İptal/Epikriz kilitle/Tarihçe), Yatış, **Yazdır** (çok uzun form listesi: barkod, kol bandı, epikriz, taahütname, onam, SGK hizmet dökümü, proforma…), E-Nabız.

**Faturalar / Ödemeler-Avanslar / İndirimler / Dosyalar / Notlar:** her biri grid + araç çubuğu (ayrıntı aşağıdaki videolarda).

---

## 3. Hasta kabul = protokol açma (Video 3) — EN KRİTİK EKRAN

İki yol:
- **Randevulu:** Randevu Arama (Durum=Protokol Bekliyor) → satır seç → **Hasta Kabul**. Bölüm/hizmet randevudan otomatik dolu gelir.
- **Randevusuz:** Hasta Kartı → **Hasta Kabul ▾** menüsü → geliş türü: Poliklinik / ACİL / Günübirlik / Yatış / Kontrol / Donör.

**HASTA KABUL MODALI alanları (protokol bloğu):**
- Geliş Tarihi · **Geliş Tipi** (Ayakta/Yatarak…)
- **Protokol Tipi**: Genel Muayene, Kontrol (Ameliyat Sonrası), Laboratuar, Radyoloji, Yatış Öncesi Ayaktan, Donör, Check-Up
- Bölüm · Doktor
- SGK · Özel Sigorta
- Anlaşmalı Kurum · İndirim Grubu
- Kampanya · Şirket Bilgisi
- Misafir Doktor (+ **Nöbetçi Doktor** checkbox, **Doktoru Hasta Seçti** checkbox)
- Tercih Sebebi
- Özel Durum · **112 Protokol No**
- **Yönlendiren · Triaj Beyanı**
- Bağlı Protokol · **Yeni Doğan** · **KDV'den Muaf**
- Şirket · Dosya

**Medula Provizyon bloğu (SGK kurum tipinde)** — bizde SAMHI/İcbari Sığorta karşılığı:
Takip Alma, **Biyometrik Doğrulama** (varsayılan açık), Katılım Payından Muaf, Branş/Devredilen Kurum, Takip/Yatış bitiş tarihi, Tedavi/Sigortalı türü, Prov. tipi/yakınlık, plaka/vaka tarihi, Yeni Doğan (anne kimlik/sıra/doğum).

**Kaydet** → protokol açılır → **İşlem Havuzu**'na düşer.

**İşlem Havuzu:** sol protokol listesi + sağ işlem grid. Araç: Yenile, **Fatura**, **İndirim**, **Ekle**, radyo **Fatura Bekleyen / Tümü**. Alt özet: HASTA / SGK borç payları, avans/katılım payı borcu.
- Protokol sağ-tık: Düzenle / Durum / Yazdır / Medula İşlemleri.
- İşlem sağ-tık: Doktor, Tarih, **Tutar** (Hasta payını kuruma aktar / Kurum payını hastaya aktar), Paket, Yeniden Fiyatlandır, Durum, **Özel Onay**, Yazdır, Diğer (Farklı protokole aktar, Hizmet değiştir, İptalleri göster).

---

## 4. Protokole işlem ekleme (Video 4)

**Ekle ▾** menüsü: Hizmet / İlaç-Malzeme / Tetkik / Ameliyathane Hizmetleri / Hastanın Teklifleri.

İki ayrı ekleme kanalı:
- **Order (istem) ekranı** — hizmet/tetkik için: katalog ağacı + arama + Genel/Favoriler sekmeleri; seçince bölüm/doktor/tarih/uygulayan dialogu → Ekle. Laboratuvar için ayrı "Laboratuvar İstem" dialogu (numune + açıklama). Yeşil "Kayıt başarılı" toast'ı.
- **Hastaya Çıkış ekranı** — ilaç/malzeme için: Depo + Malzeme tipi (İLAÇ/KAN/TIBBİ SARF) + stok durumu; **lot/seri/miad** takibi; reçete sınıfı renk kodu (Normal/Mor/Turuncu/Yeşil/Narkotik/Yüksek Riskli). Malzeme stoktan düşülür.

Her kalem eklenince HASTA/SGK tutarları anında güncellenir.

---

## 5. İstek Havuzu — doktor/hemşire istemlerini protokole alma (Video 5)

Doktor/hemşirenin açtığı istemler (tetkik, lab, radyoloji, randevulu hizmet) **İstek Havuzu** alt sekmesinde bekler.
Akış: satırları seç (çoklu) → **İşleme Al** (açılır düğme) → istemler İşlem Havuzu'na kalem olarak düşer, İstek Havuzu boşalır.
İstem tutarı ile İşlem Havuzu'ndaki KDV'siz tutar farklı → protokole eklenince fiyat/KDV ayrıştırması uygulanıyor. Randevu gerektiren istemler için ayrıca **Randevu** düğmesi ve "Randevu" sütunu var.

---

## 6. Onam + Dosya Kontrol (Video 6)

**Onam Formları** ekranı: tarih aralığı + radyo **Bekleyen / Tamamlanmış / Tümü** + Listele. Ad/protokol filtre.
Grid: **Tip** (Onam Formu | Dosya), Tarih, Rapor/Doküman Adı, Protokol No, Ad-soyad, Bölüm, Doktor, **Durum (Bekliyor)**, Protokolü Açan Personel.
Doküman tipleri envanteri: Özet Epikriz, Pasaport, Protokol Defteri, Kurum Faturası + çok sayıda matbu onam formu (tomografi/MR/sintigrafi onam formları vb.).
Dosya satırı sağ-tık: **Yazdır / Dosya Yükle**. Dosya Upload modalı: Bağlantı Tipi, Dosya Tipi, Doküman Grubu, dosya seç, **PDF formatında kaydet**. Dosya türleri: jpg/png/mp4/pdf/doc/xls.
Mantık: vezne, çıkış/fatura öncesi "Bekleyen" filtresiyle eksik onam/dosyayı tarar; yükleyince kayıt tamamlanır.

---

## 7. Dönem açma / devir / kasa kapatma (Video 7) — EN DETAYLI

**Dönem Bilgileri** ekranı. Araç: **Dönem Aç, Dönem Kapat, Dönem Devir Al, Yazdır** (Devir Al düğmesi yetki/duruma bağlı görünebilir).
Sol "Açık Dönem Bilgileri": Adı, Dönem No, Açılış Tarihi, Max. Kapanış, **Mesai Tipi**, **Banko**, **Yazar Kasa**.
Alt sekmeler: **Kasa Hareketleri** (Ekle/Onayla/Sil) + **Kredi Kartı Detayları**. Sağ: Bekleyen/Ödemesi alınmamış faturalar. Alt: **Kapalı Dönemler** listesi.

1. **Dönem Aç:** Vezne adı, başlangıç tarihi, Max. kapanış, Mesai Tipi, Banko, Yazar Kasa, Açılış-Kapanış Matbu No → "Dönem Bilgileri Kaydedildi. Aktif hale getirildi!".
2. **Kasa Hareketi:** radyo **Ana Kasa / Kasalar Arası**; İşlem Tipi (Giriş/Çıkış), Personel (kasalar arasında hedef vezne), Tutar/Para birimi, Açıklama. Durum=Onaylandı.
3. **Dönem Devir Al:** üst "Açık Dönemler" (başka veznelerin dönemleri, Durum=Yeni Vezne Dönem); alt "Dönem Protokolleri" (Tip: Faturalanmamış / SGK Takibi Eksik; Geliş/Protokol tipi; Kurum/Hasta borç). Onay kutusuyla seç → Tamam → kendi dönemine taşı (vardiya devri).
4. **Dönem Kapama:** "Kasa Kapanış Bilgileri" sayım alanları (Fatura/Fiş, Nakit/KK, KK Dolar/Euro, Çek/Senet/Havale, Dolar/Euro, Sterlin/CAD/CHF, İptal fatura/fiş, Avans/Katılım payı). Alt **Bekleyen İş Listesi** (Tipi, Kalan Gün, Onay Durumu, Onay Açıklaması…). İki aşama: önce Kaydet (sayım), sonra Dönem Kapama. Bekleyen işe açıklama girilebilir.

Mantık: bir vezne aynı anda **tek açık dönem**. Devir = vardiya devri. Kapatma = nakit sayımı + bekleyen iş kontrolü.

---

## 8. Tahsilat ve fatura (Video 8)

İşlem Havuzu → **Fatura** → "Hasta Fatura" modalı.
- Sol Fatura: Tarih, **Cari** (Hasta), Protokoller, **Fatura Türü** (Normal / E-Fatura / E-Arşiv / Fiş / Diğer), Matbu No, GSM-Mail (E-Arşiv/E-Fatura'da e-posta zorunlu), **KDV'den Muaf**, Para birimi/kur.
- **Kalemler** grid (protokole gruplu): işlem tipi/kod/ad/miktar/KDV oranı/tutar. SGK Katılım payı kalemi kırmızı.
- Sağ **Tutarlar**: Fatura / Ödeme / Kalan.
- **Yeni Tahsilat** ödeme tipleri: Nakit, Kredi Kartı, Havale/EFT, Çek, Senet, Maaş Kes., Cari, Eksik Tah., Avans → **parçalı/kısmi tahsilat** desteklenir.
- Kredi Kartı → ayrı "Ödeme Bilgileri" modalı: Pos Cihazı, Pos (banka POS listesi), Banka, Şube/Hesap, Kart Sahibi, Kart ilk/son dört hane, Onay Kodu/Taksit.
- Kalan 0,00 → tam tahsilat → Kaydet.

---

## 9. Fiyat verme / teklif (Video 13)

Fiyat Verme ekranı: hasta + üst alanlar (Bölüm/SGK/Doktor/Kampanya/İndirim grubu/oranı, Geliş/Protokol tipi). Toolbar: **Hizmet Ekle / Malzeme Ekle / Ameliyathane İşlemleri / Kaydet**.
- Hizmet Seçim modalı: fiyat listesi + kategori + hizmet tipleri (Ameliyat/Laboratuar/Muayene/Fizik Tedavi/Diğer); seçilenler alt gride.
- Malzeme Çoklu Seçim: İlaç/Tıbbi Sarf, alış birim/fiyat/KDV.
- Ameliyathane: ameliyat + **Hesapla** → otomatik yan kalemler (kullanım bedeli, anestezist, gaz, asistanlar).
- Kaydet → **Teklif Açıklaması** → "Teklif Kaydedildi". **Teklifler** sekmesinde birikir (tarih + açıklama + taraf fiyatları). Teklif = fiyat teklifi, fatura değil.

---

## 10. Evrak Takip (Video 14)

Fatura evrağının fiziksel teslim/iade süreci.
Arama: Fatura tarihi, **Durum**, Vezne → Listele. Üst grid faturalar; alt grid **Fatura Evrak Teslim Detay** (hareket geçmişi).
**Evrak Durumu makinesi:** Veznede → Vezneden Teslim Edildi → Medikal Muhasebede → Vezneye İade (İç İade) / Vezneye İade (Dış İade).
Teslim: onay kutusu + **Evrak Kontrol** modalı (evrak checklist: Nüfus cüzdan fotokopisi, İrsaliye, Fotoğraf, Test sonuç…) → Tamam. Her hareket personel+tarih+açıklama ile birikir (silinmez). Kuruma kargo no/firma alanları var.

---

## 11. Ödeme Takip (Video 15)

Faturaların ödeme durumu; açık/bekleyen ödemeleri tahsil, ödenmeyenleri hukuksal takibe alma.
Arama: tarih, hasta/protokol/matbu fatura no. Sekmeler: **Faturalar / Katılım Payı**.
Faturalar grid: tutar bilgileri (KDV'li/siz, İade, Ödeme, **Bekleyen Ödeme**, **Kalan Avans** — renkli vurgulu). Satır **sağ-tık → Ödeme / Hukuksal Takip**.
- **Ödeme** → Fatura Ödeme modalı (kalem bazlı tahsilat, çok kanallı: Nakit/KK/Havale/Senet/Cari/Maaş kesintisi, bakiye gridi).
- **Hukuksal Takip** → Tarih, Fatura no, bekleyen tutar, avukat yazı/referans, Süreç, sekmeler: Kontrol Formu / Notlar / Dosyalar / Fatura Detayları / Tarihçe.
- **Katılım Payı** sekmesi: protokol başına katılım payı (sabit tutar).

---

## 12. GFK Takip — provizyon/müstehaklık (Video 16)

Faturalamadan önce protokollerin kurum onayı kontrolü. Kurum radyosu: **Hasta / ÖSS-AK / SGK**.
Arama: tarih, protokol, bölüm, doktor, vezne, kimlik/ad/soyad, "Yatan Hastalar Hariç" → Listele. Toolbar: Provizyon Al, Müstehaklık Sorgula.
- ÖSS/AK → **OSS Provizyon** modalı: provizyon tipi/no, işlem tipi (Oran/Tutar/Diğer), poliçe oranı/limiti, işlemler gridi (poliçe oranıyla hasta/kurum payı dağıtılır).
- SGK → **Medula Takip** modalı (bizde SAMHI takip): genel bilgiler, biyometrik kimlik doğrulama, takip tarihleri, tedavi/provizyon tipleri, Yeni Doğan.

---

## 13. Onay Bekleyen Protokoller (Video 17)

Faturalanmamış, onay bekleyen protokoller. Arama: tarih, protokol, vezne, **Durum=Onay Bekliyor** → Listele. Tip=Faturalanmamış.
Satır → **Protokol Onayı** modalı: **Gün** (onay süresi) girilince **Max. Onaylı Tarih** otomatik hesaplanır + Açıklama → Tamam. Onay = protokolün faturalanabilmesi için verilen süreli izin.

---

## 14. İndirim ve İade onay süreçleri (Video 9-12)

**İndirim talep** (3 şekil): Oran / Tutar / Alınacak Tutar — canlı hesaplama. İndirim açıklaması kategorisi (Başhekim/Doktor/Yönetim/VİP Kurumlar). İşlem tipi bazlı indirim.
**İndirim onay:** İstek/Onay çift başlıklı grid; Onayla/Reddet/Dosyalar; sağ-tık "Onay Grubu Değiştir". **İndirimde numaralı seviye YOK** — onay grubu + kategori ile yetkilendirme.
**İade onay (çok kademeli — numaralı seviye BURADA):** "Alıcılar" sekmesinde **Seviye 1/2/3** onay zinciri + "Onayı Beklenen Personel" sıra göstergesi; sağ-tık Onayla/Reddet/Onay İptal/Yazdır. **Avanslar** sekmesi: avans → İade Edildi, Kalan Avans Tutarı. Dokümanlar Aç/Ekle. 4 durum: Onay Bekliyor / Onaylandı / Reddedildi / Onay İptal Edildi.
İki görünüm: **İade Taleplerim** (talep eden, onay butonu yok) · **Onay Bekleyen İadeler** (onaylayan, sağ-tık aksiyonlu).

---

## 15. Durum makineleri (özet)

| Nesne | Durumlar |
|-------|----------|
| Hasta | Ön Kayıt / Kesin Kayıt (+ Gizli Hasta) |
| Protokol | Açık / Kapalı / İptal / Birleştirilmiş |
| Fatura | Provizyon / Fatura |
| Fatura evrağı | Veznede / Teslim Edildi / Medikal Muhasebede / İç İade / Dış İade |
| İndirim | Onay Bekliyor / Onaylandı / Reddedildi |
| İade | Onay Bekliyor / Onaylandı / Reddedildi / Onay İptal Edildi (Seviye 1/2/3) |
| Onam/Dosya | Bekliyor / Tamamlanmış |
| İstem | Başladı (İstek Havuzu) → İşleme Alındı (İşlem Havuzu) |
| İşlem | Fatura Bekleyen / Faturalanmış |
| Vezne dönemi | Açık / Kapalı |
| Onay bekleyen protokol | Onay Bekliyor (süreli izin) |

---

## 16. Doğrulanamayan noktalar (canlı sistemden teyit gerekir)

- "İşleme Al" açılır menüsünün seçenekleri (Video 5).
- "Onam Formu" tipli satırın sağ-tık menüsü (Video 6).
- Mesai Tipi / Banko / Yazar Kasa açılır listelerinin tam içeriği, Nakit Detay "…" penceresi (Video 7).
- Nakit tahsilat detay penceresi ve fatura/fiş çıktısı (Video 8).
- Teklifin ayrı yazdır adımı (Video 13).
- "Omnitech" diye bir entegrasyon görülmedi; karşılığı Medula (SGK) + OSS Provizyon (Video 16).
