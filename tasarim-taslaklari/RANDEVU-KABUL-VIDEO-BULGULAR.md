# Pusula BAK Eğitim Videoları — Randevu & Hasta Kabul Bulguları · 05.11.2026

Kaynak: `C:\Dev\Projeler\Homunculus\{Doktor,Vezne} Eğitimleri` videoları (ffmpeg + alt-ajan kare analizi).
Not: **Azerbaycan sistemi** (TƏBİB/SAMHI) — Türkiye SGK/Medula alanlarını birebir kopyalama; kendi kurum/provizyon modelimize uyarla ([[hbys-azerbaycan-saglik-sistemi]]).

## 1. Randevu yönetimi (Doktor videosu)
- Randevu durumları: **Bekliyor / Geldi / Gelmedi / İzinli**; listede ikon+sayaç, takvimde blok rengi.
- **Randevu T. vs Kabul T.** ayrı; farkı **R.Gecikme** (otomatik). ✅ YAPILDI (kabul saati+gecikme rozeti).
- Doktor ajandası Gün/Hafta; doktor seçici. ✅ (Gün: doktor çipleri, Hafta: dropdown).
- **Kapalı/bloke slotlar tipli**: Kapalı-Toplantı / -Eğitim / -Ameliyat / -İzin; Cumartesi ⊘ kapalı gün. (bizde generic "Kapalı" var, tipli değil).
- Üstte durum sayaç+filtre rozetleri. (listede kısmen var).
- Zengin randevu satırı: cinsiyet rozeti, yaş+doğum+hasta no, şube, işlem türü (Ameliyat/Radyoloji), serbest not.
- Aynı slota yan yana çoklu randevu; 20 dk slot çözünürlüğü.

## 2. Hasta Kabul (Vezne — Randevulu/Randevusuz)
- **Randevulu vs randevusuz tek fark giriş kapısı**: randevulu "Protokol Bekliyor" randevudan, randevusuz hasta aramadan → **aynı Hasta Kabul formu + aynı protokol/provizyon akışı**.
- **Birleşik Hasta Kabul formu**: Protokol bölümü + (TR'de Medula) Provizyon bölümü **tek pencerede**. Ayrı provizyon ekranı yok.
- **Protokol Tipi** (zorunlu): Genel Muayene / Kontrol (Ameliyat Sonrası) / Laboratuar / Radyoloji / Yatış Öncesi Ayaktan / Donör / Check-Up.
- Protokol alanları: Geliş Tarihi-Tipi (Ayakta), Bölüm-Doktor, SGK-Özel Sigorta, Anlaş.Kurum-İnd.Grubu, Kampanya, Misafir/Nöbetçi Doktor, Doktoru Hasta Seçti, Yönlendiren, Triaj Beyanı, Bağlı Protokol, Yeni Doğan, KDV Muaf.
- **İşlem Havuzu**: protokolün hizmet grid'i; her işlem **hasta/kurum payına otomatik** bölünüyor; alt barda **HASTA / SGK borç toplamları** + katılım payı.
- **İşlem sağ-tık**: Doktor (Yapan/İsteyen/Misafir) · Tutar (Hasta/Kurum/Hasta↔Kurum aktar) · Yeniden Fiyatlandır · Farklı Protokole Aktar · Hizmet Değiştir · Özel Onay · Hizmet Barkodu yazdır.
- **Protokol sağ-tık**: Düzenle (Kurum/Bölüm/Doktor/Tarih/Tip) · Durum (Aç/Kapat/Birleştir/İptal/Tarihçe) · Yazdır.
- Onam Formları + Özet Epikriz listesi (protokol bazlı, Yazdır/Dosya Yükle).

## 3. Hasta Arama & Hasta Kayıt (Hasta360)
- **FİN ile otomatik demografik doldurma** (EN KRİTİK): Kimlik No'ya FİN girilince kart baştan sona doluyor (ad/soyad/cinsiyet/doğum/baba-anne/cep/SGK), Hasta No otomatik atanıyor. → Azerbaycan'da TƏBİB/mygov karşılığı.
- **Çok kriterli arama + kolon filtre**: Kimlik No, Adı, Soyadı, Baba/Anne Adı, Hasta No, Kart No, Pasaport; + Protokol No, Bölüm, Doktor, Tarih aralığı. Sonuç kolonları: Durum, Hasta No, Kimlik, Ad, Soyad, Baba/Anne, Doğum, SGK, ÖSS, AK, Telefon, Pasaport.
- **"Kayıt" ≠ "Kabul"**: kayıt bir kez; sonra **Hasta Kabul ▾**: Poliklinik(Ctrl+P)/Acil(Ctrl+A)/Gözlem(Ctrl+G)/Yatış(Ctrl+Y)/Kontrol(Ctrl+K)/Donör. Her kabul yeni geliş/protokol.
- **Hasta Kartı blokları**: Genel Bilgiler, İletişim (cep/ev/iş/email/SMS-Mail/adres), Diğer (dil/engel/gelir/meslek/eğitim/kan grubu/plaka/**KVKK izni**), Kurum (SGK/Medula/Özel Sigorta/Anlaş.Kurum/İndirim Grubu), Kimlik (tip/il/ilçe/seri/doğum yeri/medeni hal).
- **Hasta360 sekmeleri**: Gelişler, Faturalar, Ödemeler/Avanslar, İndirimler, Dosyalar/Resimler (kimlik/pasaport arşivi, PDF), **Notlar (Uyarı chk = hasta açılınca sticky uyarı)**.
- **Mükerrer kayıt kontrolü**: aynı FİN yeni kayıt açmaz, var olanı getirir.
- **Üst kimlik şeridi**: seçili hastada ad-soyad/FİN/Hasta No/Tip/Uyruk/Cinsiyet-Doğum/Kat-Yatak sürekli görünür.

## Öncelikli eksikler (uygulanacaklar)
1. ✅ Kabul saati + gecikme (yapıldı)
2. 🔴 **FİN autofill'i hasta kabul/ayaktan kayıt formuna da** (randevuda var; kabulde de olmalı) + mükerrer kayıt kontrolü
3. 🔴 **Protokol Tipi** kabul anında (var mı kontrol) + Randevu→"Protokol Bekliyor"→Kabul köprüsü (randevudan bölüm/doktor/hasta otomatik)
4. 🟡 **Uyarı notu (sticky)** — hasta açılınca uyarı veren işaretli not
5. 🟡 **Tipli kapalı slot** (Toplantı/Eğitim/Ameliyat/İzin) + kapalı gün
6. 🟡 **İşlem sağ-tık**: hasta↔kurum pay aktarımı, yeniden fiyatlandır (vezne'de kısmen var)
7. 🟡 Çok kriterli hasta arama ekranı + kolon filtre
8. ⚪ Hasta kartı blok derinliği (KVKK/kimlik/iletişim), dosya-kimlik arşivi, üst kimlik şeridi
