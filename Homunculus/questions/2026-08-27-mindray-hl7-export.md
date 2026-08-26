---
type: question-note
date: 2026-08-27
status: UNVERIFIED — not vault-backed
---

# Mindray cihazlarında HL7 export — çalışma notu

> **Bu bir kaynak değildir ve alıntılanamaz.**
>
> Aşağıdaki metin dışarıdan yapıştırılmış, kaynağı doğrulanmamış bir özettir. `raw/` altında
> durmuyor çünkü `raw/` kayıt altındaki delildir: künyesi (yayıncı, sürüm, erişim tarihi) olmayan
> bir metni oraya koymak, sonradan gerçek bir kaynakmış gibi alıntılanmasına yol açar — vault'un
> güvenilirliğinin dayandığı zincir tam olarak budur.
>
> Buradaki iddialar **satıcı dokümanıyla teyit edilmeden** hiçbir tasarım kararına gerekçe
> yapılmamalıdır. Teyit edilirse, resmî doküman kurallara uygun künyeyle `raw/` altına alınır ve
> bu not ona bağlanır.

## Neden burada duruyor

Pilotun şu anki tıkanıklığına doğrudan bakıyor. Elimizdeki Welch Allyn cihazı WACP konuşuyor ve
arkasında Connex sunucusu yok; alternatif olarak Mindray yolu değerlendiriliyor. Bu notun iddia
ettiği en kritik nokta, doğruysa, aynı sınıftan bir engeldir:

- **HL7 export birçok Mindray modelinde fabrikadan kapalı gelir ve lisans anahtarı gerektirir.**
- ePM serisinin doğrudan LAN üzerinden HL7 verebildiği, BeneVision N serisinin PDS + HL7 kullandığı
  belirtiliyor.
- Büyük kurulumlar için eGateway adlı merkezi bir toplayıcı tarif ediliyor.

Doğrulanması gereken soru tek cümle: *"Bu ünitedeki Mindray modelinde HL7 ORU export lisansı var mı,
yoksa satın alınması mı gerekiyor?"*

## Yapıştırılan metin (olduğu gibi, düzenlenmemiş)

Mindray cihazlarında HL7 veri aktarım (export) opsiyonu, cihazların ürettiği vital bulguları, laboratuvar sonuçlarını veya anestezi verilerini Hastane Bilgi Yönetim Sistemine (HBYS/HIS) veya Elektronik Sağlık Kayıtlarına (EMR) entegre etmek için kullanılır.Bu entegrasyonu sağlamak için Mindray iki ana yöntem sunar:1. Mindray eGateway Entegrasyon Yöneticisi (Merkezi Çözüm)Büyük ölçekli hastaneler ve çoklu cihaz takipleri için kullanılan en yaygın yöntemdir.Tek Hat Veri Akışı: Mindray eGateway, tek bir sunucu üzerinden 200 ile 1200 adet arası Mindray hasta monitörü, anestezi cihazı ve vital bulgu cihazından gelen verileri toplar.Protokol Desteği: HL7 v2.1 ile v2.6 sürümleri arasındaki tüm standartları ve IHE PCD (Patient Care Device) profilini destekler.Veri Yedekleme: Ağ kesintisi yaşansa dahi cihazlardan 48 saate kadar geçmişe dönük veriyi (backfill) otomatik olarak çekip HBYS'ye aktarabilir.2. Cihaz Üzerinden Doğrudan HL7 Çıkışı (Lokal Çözüm)Yeni nesil Mindray cihazları, harici bir yazılıma ihtiyaç duymadan doğrudan HL7 formatında çıktı üretebilir.ePM Serisi: Doğrudan LAN (Ethernet) portu üzerinden HL7 formatında veri çıkışı verebilir.BeneVision N Serisi: PDS (Patient Data Share) protokolünü ve HL7 v2.3.1 / v2.5.1 standartlarını kullanarak veri aktarır.Anestezi Cihazları (A Serisi): Ameliyathane entegrasyonları için geliştirilen bu sistemler, IHE PCD Rosetta profili ve standart HL7 veri paketleri (ORU^R01 mesaj yapısı) ile çalışır.💡 Teknik Kurulum İçin Önemli NotlarYazılım Lisansı/Opsiyon Anahtarı: Birçok Mindray modelinde HL7 export özelliği fabrikasyon olarak kapalı gelebilir. Bu özelliğin aktif edilmesi için Mindray Türkiye veya distribütöründen HL7 Lisans Opsiyonu (Yazılım Anahtarı) satın alınmalıdır.Fiziksel Bağlantı: Cihazın arkasındaki RJ45 (Ethernet) veya seri port (RS232) üzerinden bağlantı sağlanır. Doğrudan bilgisayar bağlantılarında cross (çapraz) kablo gerekebilir.Mesaj Tipi: Mindray cihazları hastane sistemine genellikle anlık yaşamsal bulguları iletmek için ORU^R01 (Observation Result - Unsolicited) HL7 mesaj tipini gönderir.Bu opsiyonu hangi Mindray cihaz modeli (örn: BeneVision N15, ePM 10, BC-5150) için aktifleştirmek istiyorsunuz? Cihazın tam modelini belirtirseniz doğrudan o modele ait HL7 menü adımlarını veya lisans gereksinimlerini paylaşabilirim.
