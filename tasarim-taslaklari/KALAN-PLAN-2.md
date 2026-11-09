# HBYS — Kalan İşler Faz Planı 2 (onaylandı · baştan sona yapılıyor)

Sahip: "Planı yaz, hepsini yap" + tüm kullanıcı-kolaylığı önerileri. Onaysız, sırayla; bitince sahip bakar.
Tarih: 2026-10-22 · Dal: `hbys/gelistirme`

## Faz G — Ayaktan akış uçtan uca (en önemli)
Mantık: hasta vezneye/kabule kimlik verir → **hafif kayıt** açılır → hekimin **iş listesine** düşer → **"Göreve git"** → hasta kartı → başvuru tipine göre modüller.
- **G1.** Kabul'e **"Ayaktan / poliklinik kayıt"** sekmesi: kimlik (ad/FİN) + bölüm + doktor + geliş nedeni; **yatak zorunlu değil**; encounter=`ayaktan`; poliklinik muayene odası slotuna atanır.
- **G2.** Kayıt açılınca Otomatik Hizmet Tanımı'ndan bölümün **muayene hizmeti otomatik istem** olarak eklenir; hasta **Tüm Gelişler**'de görünür.
- **G3.** "Göreve git" → hasta kartı → ayaktan sekmeleri (özet/belge/istem/sonuç). (Encounter yapısı hazır; kabul tarafı bağlanacak.)

## Faz H — İK / Personel kartı
- **H1.** İK'ya **"Personel ekle"** + detaylı kart (sekmeler): Genel (personel tipi/meslek/görev/ünvan/bölüm/branş/şube + doktor: diploma/tescil/muayene süresi/e-reçete), Kişisel (pasaport/anne-baba/kan grubu/medeni/eğitim), Nöbet-Mesai-İzin, Çalışma Takvimi (haftalık), Yakınları, Zimmet, Diğer Özellikler (yetki işaretleri), Randevu Özellikleri.
- **H2.** Listeden aç → düzenle/sil.

## Faz I — Tutarlılık + kullanıcı kolaylığı (proaktif, sahibin onayladığı)
- **I1.** Her listede **Ekle / Düzenle / Sil** tutarlı (eksik olanlara ekle).
- **I2.** Üst barda **global "+ Yeni"** hızlı menü: Hasta kabul · Randevu · Reçete · Personel (yetkiye göre).
- **I3.** Büyük listelerde **arama + Yazdır / Dışa aktar**.
- **I4.** Kayıtlarda kullanıcıya görünür **Tarihçe** düğmesi (kim ne zaman).
- **I5.** **Yazdır** butonları eksik yerlere (reçete, istem, epikriz, onam, raporlar, barkod).

## Faz J — Diğer roller
- **J1.** "Diğer Özellikler"deki yetki/rol işaretleri (randevu temsilcisi, çağrı merkezi, danışman, UHD, ameliyat personeli, dijital marketing…) rol/yetki modeline eklenir.

## Kurallar (değişmez)
Kendi kodlarımız/isimlerimiz · Azerbaycan muadili (TABIB/SAMHI) · her özellik iki taraflı · sistem tanı/doz koymaz · canlıda yalnız test verisi silinir.

## Sahip ara ara verecek
Formlar/görseller gelmeye devam edecek; ayrıca ilaç/malzeme listesi ve branş SUT kodları sahipten.
