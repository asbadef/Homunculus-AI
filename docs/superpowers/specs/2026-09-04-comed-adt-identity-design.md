# Comed ADT → hasta kimliği: ad ve yatak panoya nasıl gelir — tasarım

**Tarih:** 2026-09-04
**Durum:** onaylandı (kullanıcı, 2026-09-04), uygulama planı bekliyor

## Neden

Bugün pano kartları yalnızca **protokol numarası** taşıyor. Connex Spot'ta yazılan ad ve oda
HL7'ye hiç ulaşmıyor: cihaz, host'tan "hasta bulundu" cevabı alınca kendi alanlarını host'un
cevabındaki bilgiyle değiştiriyor, bizim cevabımız ise bilerek yalnızca kimlik taşıyor. Ölçümlerin
geldiği HL7'de `PID-5 = ^^^^^^L`, `PV1-3 = WA^^` — ad ve oda boş (sahada doğrulandı, 2026-09-04).

Doğru kaynak cihaz değil, hastanenin HIS'i: **Comed**. Hemşire cihaza Comed'deki protokol
numarasını girer; ad, doğum tarihi ve yatak Comed'den gelir. Bu, cihazda isim yazmayı tamamen
kaldırır ve yanlış hastaya ölçüm yazma riskini düşürür.

## Kapsam

**İçinde:** Comed'den HL7 ADT akışı almak; protokol numarası → ad/doğum tarihi/cinsiyet/yatak
kaydı; cihaz sorgusuna ad ile cevap vermek; panoda ve mobilde ad + yatak göstermek; Comed
bağlanana kadar panelden elle giriş.

**Dışında:** Homunculus'tan Comed'e vital gönderimi (ORU çıkışı); yatış modülünün iş akışıyla
(taslak/imza/ekip/nakil) birleştirme; Dräger Infinity tarafı; Comed'in kendi ekranlarında
değişiklik.

**Başarı ölçütü:** Comed'de yatağa yerleştirilen hasta ~5 saniye içinde panoda adı ve yatağıyla
belirir; cihazda protokol numarası girilince cihaz adı gösterir; taburcuda kart yataktan düşer;
ad hiçbir log'a, dosya adına veya depoya girmez.

## Mimari

```text
Comed ADT ──MLLP──▶ köprü (2575) ──┬─▶ kimlik aynası (SQLite, köprüde)
                                   │        └──▶ cihaz sorgusu cevabı (ad, DOB, cinsiyet)
                                   └─▶ tampon ──▶ /ingest (Patient + Encounter) ──▶ kimlik kaydı ──▶ pano
Connex ──WACP──▶ NCE ──MLLP──▶ köprü (2575) ──▶ tampon ──▶ /ingest (Observation) ──▶ motor ──▶ pano
```

Dört parça, her biri tek işli:

1. **ADT alıcı** (`edge/adt.py`): HL7 ADT mesajını `PatientIdentity` kaydına çevirir. Saf
   fonksiyon; ağ ve durum yok. Mevcut MLLP sunucusu mesajı tipine göre üçe ayırır: sorgu
   (`QBP`) → `edge/pdq.py`, ADT → burası, `ORU` → bugünkü işleyici.
2. **Kimlik aynası** (`edge/identity.py`): protokol no → ad, doğum tarihi, cinsiyet, durum.
   Tek amacı cihaz sorgusuna ağ beklemeden cevap vermek. Gözlem tamponuyla aynı birimde.
3. **API kimlik kaydı** (`api/identity.py` + tablo): `/ingest`'e gelen FHIR `Patient` ve
   `Encounter` kaynaklarını kabul eder; Postgres'te şifreli alanlarla tutar; panoya yayar.
4. **Gösterim:** pano ve mobil kartlarında ad + yatak; kayıt yoksa bugünkü davranış.

Cihaz sorgusunun kaynağı **yalnızca ayna**, panonun kaynağı **yalnızca API kaydı**; ikisi de aynı
ADT mesajından beslenir, birbirine sormaz. Comed kesilirse ölçüm akışı etkilenmez; yalnızca yeni
yatışlar adsız kart olur.

## Mesaj sözleşmesi (Comed → köprü)

Taşıma: HL7 v2 / MLLP, `172.100.101.72:2575`. Her mesaja ACK: okunduysa `AA`, protokol numarası
yoksa `AE` + sebep (ad asla log'a yazılmaz).

| Tip | Anlamı | Kayıt etkisi |
| --- | --- | --- |
| A01 / A04 | yatış / kayıt | kimlik oluştur veya güncelle, yatak yaz, durum "yatan" |
| A02 | nakil | yalnızca servis/oda/yatak değişir |
| A08 | güncelleme | ad, doğum tarihi, cinsiyet güncellenir |
| A03 | taburcu | durum "taburcu", yatak boşalır, 24 saat sonra kayıt silinir |
| A11 / A13 | yatış iptali / taburcu iptali | A03 / A01 gibi işlenir |
| diğer | — | `AA`, yok sayılır, sayılır |

Alanlar: **PID-3.1 = Comed protokol numarası** (cihazda girilen numarayla aynı olmalı; tasarımın
anahtarı), PID-5 = soyad^ad, PID-7 = doğum tarihi (YYYYAAGG), PID-8 = cinsiyet, PV1-3 =
servis^oda^yatak, MSH-7 = mesaj zamanı. Tanınmayan segmentler yok sayılır.

**Sıra:** aynı protokol numarası için MSH-7'si daha eski bir mesaj daha yeni kaydın üstüne yazmaz.
Aynı mesajın tekrarı etkisizdir.

**Bilinmeyen numara:** köprü cihaz sorgusuna yine "bulundu, yalnızca kimlik" cevabı verir (bugünkü
davranış). Ölçüm hiçbir zaman engellenmez; kart adsız düşer ve rapor satırında sayılır. Comed'den
kayıt gelince kart tamamlanır.

## Kimlik kaydı ve PHI

**API kaydı (Postgres).** `patient_identity`: protokol no (kiracı içinde tekil), ad, doğum tarihi,
cinsiyet — mevcut `EncryptedString` tipiyle şifreli; servis/oda/yatak, durum, kaynak
(`comed` | `manuel`), `updated_at` açık. Audit'e `identity` olayı yazılır: protokol no, olay tipi,
kaynak — **ad yok**.

**Köprü aynası (SQLite).** Yalnızca cihaz sorgusu için: protokol no → ad, doğum tarihi, cinsiyet,
durum. Gözlem tamponuyla aynı Docker biriminde, yalnızca root okur. Bu, hastane sunucusunun
diskinde ad tutmak demektir; gözlem tamponu zaten protokol no + değer tutuyor, koruma düzeyi
aynıdır. Taburcudan 24 saat sonra satır silinir.

**Elle giriş (geçici).** Panelde küçük bir form: protokol no, ad soyad, yatak. Aynı `/ingest`
yolundan gider, kaynak `manuel` işaretlenir. Comed bağlanınca form kapatılır.

**Depo kuralı.** Testlerde ve örneklerde yalnızca sentetik isimler; gerçek protokol numaraları ve
isimler hiçbir belgeye, log'a, dosya adına girmez.

## Pano, mobil, cihaz cevabı

Pano verisine kart başına `identity` alanı eklenir: ad soyad, yatak etiketi, durum, kaynak,
güncelleme zamanı; kayıt yoksa boş. Kimlik kaydı geldiğinde pano ölçüm beklemeden güncellenir.

**Web:** kart başlığı ad soyad, altında yatak (servis/oda/yatak) ve küçük kaynak notu
("Comed 14:02"). Kayıt yoksa protokol numarası ve "kimlik kaydı yok" etiketi; uydurma ad asla yok.
Taburcuda 24 saat "taburcu" rozeti, sonra veri yoksa kart düşer. Sıralama değişmez (riske göre).

**Mobil:** aynı veri, aynı kurallar.

**Cihaz sorgusu:** numara kayıtlıysa cevap ad, doğum tarihi ve cinsiyet taşır; cihaz adı gösterir,
hemşire doğru hastayı gördüğünü onaylar. Kayıtlı değilse bugünkü kimlik-only cevap. Kayıt dışı bir
ad hiçbir koşulda üretilmez.

## Hata durumları

| Durum | Davranış |
| --- | --- |
| ADT'de protokol numarası yok | `AE` + sayaç, kayıt yok |
| Tanınmayan ADT tipi | `AA`, yok sayılır, sayılır |
| Bozuk mesaj | `AE`, bağlantı açık kalır |
| API ulaşılamıyor | kimlik kaydı gözlemlerle aynı tamponda bekler, sırayla iletilir |
| Ayna yazılamıyor | log + sayaç; ölçüm akışı etkilenmez, sorguya kimlik-only cevap |
| Comed kesildi | mevcut kayıtlar durur, yeni yatışlar adsız; raporda "son ADT: N saat önce" |

Sayaçlar: köprü rapor satırına `adt=` ve `kimliksiz kart=`; `nce-doctor.sh`'a kimlik kayıt sayısı
ve son ADT zamanı.

## Test planı

- **Birim:** ADT alan çıkarımı (her tip için), tip → etki tablosu, sıra kuralı (eski mesaj yenisini
  ezmez), tekrar eden mesaj etkisiz, ayna oku/yaz/sil, yeni sorgu cevabı (kayıtlı ve kayıtsız).
- **API:** `Patient`/`Encounter` → pano kimliği; audit'te ad bulunmadığının testi; taburcu + 24
  saat kuralı; kiracı izolasyonu.
- **Uçtan uca:** sahte Comed ADT → panoda ad → cihaz sorgusu → ad dönen cevap → ölçüm aynı kartta.
- **Pano/mobil:** kayıt varken ad + yatak, kayıt yokken "kimlik kaydı yok", taburcu rozeti.

Tüm test verileri sentetik.

## Devreye alma sırası

1. Kod + imaj; Comed olmadan çalışır (kartlar bugünkü gibi adsız).
2. Panelde elle giriş formuyla pilot yataklar; hemşire cihazda adı görmeye başlar.
3. Comed/IT: test ortamından ADT'yi `2575`'e yönlendirir; bir yatışla doğrulanır; üretime alınır.
4. Elle giriş kapatılır; kaynak yalnız Comed.

## Comed / IT'ye sorulacaklar

1. Comed'in HL7 modülü hangi sürümü ve mesaj tiplerini destekliyor; ADT çıkışı eklemek lisans
   gerektirir mi?
2. SCENARA'ya ADT gönderen motor hangisi; oraya ikinci bir hedef (Homunculus) eklenebilir mi?
3. Protokol numarası PID-3'ün hangi bileşeninde; servis/oda/yatak PV1-3'te hangi kodlarla?
4. Test ortamı var mı; ilk aşamada yalnızca yoğun bakım filtrelenebilir mi?
5. ADT gerçek zamanlı mı gidiyor, yoksa toplu mu?
6. **MSH-7 saat dilimi taşıyor mu?** Offset'siz bir zaman damgası UTC sayılır; Comed yerel Bakü
   saatini (UTC+4) offset'siz gönderiyorsa kayıtların zamanı dört saat kayar. İki Comed mesajının
   birbirine göre sırasını bozmaz (kayma her ikisinde aynı), ama taburcu sonrası 24 saatlik
   temizlik penceresini kaydırır. NCE'nin ORU'ları `+0400` taşıyor; Comed'in de taşıması beklenir,
   doğrulanmalı.

Bağlam: `docs/hastane-hl7-omurgasi-analizi.md`.
