# Pusula BAK Eğitim Videoları — Modül Bulguları (8 video, alt-ajan analizi) · 05.11.2026

Kaynak: `C:\Dev\Projeler\Homunculus\{Doktor,Hemşirelik,Vezne} Eğitimleri` (ffmpeg kare + ajan okuma).
**Azerbaycan notu:** Türkiye SGK/Medula/e-Nabız birebir KOPYALANMAZ — TƏBİB/SAMHI/e-Qaimə ve kendi kodlarımız. ([[hbys-azerbaycan-saglik-sistemi]])
**Önemli:** Doktor/hemşire ajanları bizim gerçek prototip kaynağını (app/*.js) GÖREMEDİ; o listeler "olması gereken" (doğrula-eksikse ekle). Vezne ajanı kodu gördü → **doğrulanmış** eksikler.

---
## VEZNE (doğrulanmış — kodu okudu)
1. 🔴 **Çoklu ödeme + kart detayı**: ODEME_TIP=[Kart,Nakit,Havale] tek ödeme. Ref: tek faturada çok ödeme satırı (Nakit+Kart+Avans) + kart seçince POS/banka/son-4/onay kodu/taksit. → Çek/Senet/Maaş Kesintisi/Cari/Avans mahsup ekle.
2. 🔴 **Akıllı indirim**: İndirim Şekli = **Oran/Tutar/Alınacak Tutar** (3 mod, canlı hesap) + gerekçe/onay grubu/yetki kodu + "Resmi tutara indir"/"İşlem tipine göre indir" toplu. Bizde tek-tık sabit.
3. 🟡 **Fatura kesimde**: Fatura türü (**e-Qaimə/Fiş**), KDV muaf toggle, para birimi+kur (₼/USD/EUR), teslim e-posta/SMS.
4. 🟡 **Ödemesi alınamayan fatura listesi** (dönem kapanışında devre/mali işlere taşı).
5. 🟡 **Kasa el hareketleri**: manuel giriş/çıkış + kasalar arası transfer + onay (dönem içi).
6. 🟡 **GFK filtre + toplu müstehaklık/provizyon** (tarih/uyruk/geliş tipi/yatan hariç + bekleyen tutar kolonu).
7. ⚪ Devirde kurum/hasta borç ayrımı · Max kapanış tarihi uyarısı.
(Zaten bizde daha iyi: taksit, hukuksal takip, çok kademeli iade onayı, evrak zinciri, kurumsal alacak — dokunma.)

## DOKTOR — İSTEM (doğrula)
- **İlaç order**: etken madde arama, Standart/**Hesaplanmış Doz** (kg/VYA), veriliş yolu, eşdeğer, **infüzyon akış hızı** (hacim+süre→ml/saat), uygulama (Acil/Lüzum/Planlı), sıklık (1-12/özel), saat bazlı özet (MAR), **İlaç etkileşim sorgula** + uyarı sayacı, çok adımlı onay zinciri (eczane→hemşire→uygula).
- **Lab/Rad**: hiyerarşik **katalog ağacı**+favori, çoklu seç+toplu ekle, tetkik parametreleri (yön/vücut bölgesi/çekim yönetimi/hizmet yeri), **Acil**, Rapor Yazılmasın/Hasta Başı Çekim bayrakları, **Planla**, **zorunlu iptal nedeni**.
- **Konsültasyon**: bölüm+**o bölümdeki doktoru seç**, Normal/Acil, konsültasyon notu, SUT/HUV kodlu.
- **Ameliyat**: katalogdan işlem (SUT) + **Taraf/Kesi/Yöntem/Euroscore**, anestezi tipi + anestezist değerlendirme, **onam formu seç+yazdır**, acillik+ameliyathane süresi+yatış süresi, kan rez/özellikli malzeme/frozen, yatış istemiyle birleşik + order önerileri.
- Ortak: katalog ağacı+favori+şablon, acil işareti, çok durumlu order yaşam döngüsü, Planla, çapraz istem önerileri.
(Not: bizde kesi tipi/ameliyat grubu/periyodik/konsültasyon döngüsü/narkotik bayrak zaten var — karşılaştır.)

## DOKTOR — MUAYENE/TAKİP (doğrula)
- Tek ekran iki-kolon muayene (sol anamnez: yakınma chip+"X önce", özgeçmiş/soygeçmiş, psikoloji, ağrı, **Sistem Sorgulama modalı**; sağ: fizik muayene **VKİ/VYA oto**, Detaylı Fizik modal, **ICD-10 canlı tanı**+tip+taraf, izlem/plan+Kontrol Önerildi).
- **Epikriz zengin metin editörü** + muayeneden otomatik doldurma + içinde reçete + Kaydet ve İmzala.
- **Takip (MAR) zaman çizelgesi**: order'ların saat-Gantt'ı, renk-kodlu uygulama durumları, uygulayan/istek-yapan, durum lejant matrisi.
- Hasta Uyarıları (ikonlu izolasyon/risk bayrak+tarihçe), İş Listeleri (Havuz/Epikriz İşlerim), Şablon, Footer favori başlatıcı, Kaydet ve İmzala + Tarihçe.
(Not: bizde zengin muayene editörü [docs.js], ICD-10, hasta uyarı [yeni], epikriz zaten var — karşılaştır/derinleştir.)

## HEMŞİRE (doğrula)
- **Yatay zaman çizelgesi (Gantt) takip** + renk/ikon durum dili (bekliyor/yapıldı/planlandı/gecikmiş/PRN/yeni).
- **İlaç uygulama popup: Uygula/Pas Geç/Planla** + Pas Geç gerekçe + **kimlik doğrulama (şifre/barkod imza)** + uygulayan/zaman.
- **PRN (Lüzum Halinde)**: koşul metni, Lüzum Oluştur, onay bekleme, Y.R rozeti.
- İlaç Uyarıları (etkileşim/alerji) + Vademecum.
- **Numune alma**: bekleyen test→numune oluştur→**tüp tipine göre grupla**→barkod yaz→Numune Alındı (alan+zaman); durum sekmeleri Testler/Bekliyor/Alındı/Tekrar/Kabul.
- **Toplu İlaç Uygulama** + **Hemşire Planlama** (çoklu seç; planlamada **hasta stoğu yeterlilik**).
- **İzlem/trend matrisi** (Vital/Lab/İlaç/Görüntüleme tarih×değer + trend okları), **Sıvı İzlem (Aldığı-Çıkardığı/Balans)** kalem kırılımı, Kan Gazı Barkodu, PACS/VNA.
(Not: bizde bedside vital/NEWS2, formlar [ağrı/braden/io/rass], ilaç uygula/pas geç/iade, flowsheet, numune tüp renk zaten var — karşılaştır/derinleştir.)

---
## UYGULANANLAR (bu oturum)
✅ Kabul saati+gecikme · FİN autofill (randevu+kabul) · Randevu→Kabul köprüsü · Hasta uyarı notu (sticky) · Tipli kapalı slot · Gün doktor seçimi
