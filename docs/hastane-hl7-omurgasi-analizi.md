# Hastanenin HL7 omurgası — aag3lis bulgusu ve "her şey buraya mı akıyor?" sorusu

**Tarih:** 2026-09-04
**Bağlam:** NCE (Welch Allyn, `10.10.218.5`) yapılandırması okundu: HL7 çıkışı beş yıldır
`10.10.201.33` (`aag3lis.bonadea-int.org`) adresine gidiyor ve o uçta dinleyici yok. Bu belge
o bulguyu, hastanedeki diğer HL7 izleriyle birlikte okur ve "Dräger de oraya aktarıyor olabilir mi,
tüm HL7 akışı orada mı toplanıyor?" sorusuna kanıtla cevap verir.

## 1. Ne biliyoruz (kanıt)

| Sistem | Adres | Gözlenen | Kaynak |
| --- | --- | --- | --- |
| NCE (Welch Allyn) | 10.10.218.5 | Host0 vitals → 10.10.201.33:**7776**, Host1 hasta sorgusu → 10.10.201.33:**7775**; `SaveFailedXMLCopies=1`; transform sayfaları Mart 2020'de özelleştirilmiş | NCEConfig.xml, 2026-09-04 |
| aag3lis | 10.10.201.33 | ping var; **3389 RDP açık, 445 SMB açık, 1433 SQL Server açık**; 80/443 kapalı; **7775/7776 kapalı** | Test-NetConnection (10.10.201.14'ten) + VM'den TCP denemesi |
| Win-DRGMON | 10.10.207.2 | Karl Storz SCENARA.connect: ADT dinleyici :9000, ORM dinleyici :9100 çalışıyor, ORU sağlayıcı durdurulmuş; Cerner tipi HIS profilleri; Medset PADSY; Nihon Kohden FTP; **Dräger yazılımı yok** | 2026-09-02 taraması |
| Dräger Infinity | 10.10.203.0/24 | 13 Kappa başucu + merkez istasyon; HL7 çıkışı için **Infinity Gateway** gerekir, bulunmadı | 2026-09-02 taraması |
| Homunculus VM | 172.100.101.72 | MLLP köprüsü :2575, NCE artık buraya yönlendirildi | bugün |

## 2. aag3lis nedir? (hipotezler, kanıta göre sıralı)

1. **HIS/LIS'in veritabanı sunucusu.** En güçlü okuma. SQL Server dinliyor, web yok, adı "lis"
   ile bitiyor. 2020'de Welch Allyn projesi için buraya iki geçici HL7 dinleyici açılmış (7775
   hasta sorgusu, 7776 vital alımı); proje bitmemiş ya da terk edilmiş, dinleyiciler kapanmış,
   makine asıl işi (veritabanı) için ayakta.
2. **HIS entegrasyon motorunun makinesi, kanallar kapalı.** Mümkün; bir motor (Mirth, Rhapsody,
   Cloverleaf, ya da HIS'in kendi modülü) aynı kutuda olabilir ve NCE kanalı devre dışı
   bırakılmış olabilir. Bunu ayırt edecek tek şey IT'nin envanteri; port denemesi değil.
3. **Tüm HL7 akışının toplandığı merkez.** Kanıt yok. HL7'yi *alan* taraf veritabanı değil bir
   motordur; motorun nerede olduğunu bilmiyoruz.

## 3. Dräger de oraya aktarıyor olabilir mi?

Düşük ihtimal, üç nedenle:

- Dräger Infinity'nin bu neslinde HL7 çıkışı **Infinity Gateway** yazılımına bağlı; hastanede
  kurulu olduğuna dair iz yok (Win-DRGMON'da yoktu, biyomedikale soruldu, cevap bekleniyor).
- Gateway olsaydı hedefi bir HL7 motoru olurdu; aag3lis'te bugün hiçbir HL7 portu açık değil.
- NCE'nin 2020 kanalları bile terk edilmiş; aynı dönemde Dräger için ikinci bir kanal açılıp
  yaşatıldığını düşündürecek hiçbir şey yok.

Kesin cevap tek kaynaktan gelir: **HIS ekibi / IT.** Sorular §5'te.

## 4. Bizim için ne değişiyor

- **Bugünkü karar doğru.** Host0/Host1'i bize çevirmek canlı bir entegrasyonu kesmedi; o
  entegrasyon beş yıldır yoktu.
- **Yarın için bir sorumluluk doğdu.** HIS bir gün Welch Allyn verisini isterse, NCE'nin tek
  hedefi artık biziz. O gün NCE'nin çıkışı bize değil bir **HL7 yönlendiriciye** bağlanır ve
  oradan hem HIS'e hem bize dağıtılır. Bugün gerekmiyor; tasarımı hazır tutmak yeter.
- **Asıl fırsat ADT.** Hastanede HL7 gönderen bir HIS motoru var (SCENARA'nın 9000/9100'de aldığı
  ADT/ORM onun eseri). O motordan bize bir ADT beslemesi açılırsa hasta/yatak kimliği sistem
  genelinde çözülür; bugün cihaz başında kimlik girme ve sorgu-cevap ile aştığımız sorun kökten
  kalkar. Bu, Dräger verisinden daha önce alınabilecek bir kazanım.

## 5. IT / HIS ekibine sorular (bir dakikalık, sırayla)

1. `aag3lis` (10.10.201.33) hangi sistem: HIS mi, LIS mi, veritabanı mı? Kim yönetiyor?
2. 2020'de Welch Allyn / NCE için 7775–7776 portlarında HL7 dinleyiciyi kim açtı; proje neden
   durdu; HIS bugün Connex vital verisini istiyor mu?
3. HIS'in HL7 entegrasyon motoru hangi sunucuda çalışıyor (ürün adı, sürüm)? Win-DRGMON'daki
   SCENARA'ya ADT/ORM'i o mu gönderiyor?
4. O motordan Homunculus'a (172.100.101.72:2575) bir **ADT^A01/A02/A03/A08** akışı açılabilir
   mi? Hangi kimlik alanı (PID-3) hastane protokol numarasını taşıyor?
5. Dräger monitör verisi (Infinity) HIS'e HL7 ile geliyor mu? Geliyorsa hangi kanaldan, hangi
   sunucudan? (Cevap "hayır" ise Infinity Gateway sorusu geçerliliğini korur —
   `docs/drager-infinity-biomed-sorulari.md`.)
6. Ağ politikası: klinik VLAN'lardan 172.100.101.72:2575'e MLLP izinli mi; kim onaylar?

## 6. Karar ağacı

```text
IT cevabı
├─ aag3lis = veritabanı, HL7 motoru başka sunucuda
│    ├─ motor ADT verebiliyor  → "HIS motoruna abone" dilimi: ADT alıcı + kimlik eşleme (öncelik 1)
│    └─ motor yok / kapalı     → mevcut yol (NCE→biz, cihazda kimlik) kalıcı; ADT için HIS satıcısıyla görüşme
├─ HIS Connex verisini de istiyor
│    └─ NCE çıkışını yönlendiriciye al, ikiye dağıt (küçük dilim; NCE tek hedefli)
└─ Dräger verisi HIS'e HL7 ile geliyor
     └─ aynı motordan bize ORU kopyası iste → Gateway satın almadan sürekli telemetri (büyük kazanım)
```

## 7. Yapılmayacaklar

- aag3lis'e daha fazla port denemesi yok; klinik ağda bir veritabanı sunucusuna dokunmak
  gereksiz risk ve bilgi getirmez.
- aag3lis'in SQL'inden doğrudan okuma yok: HIS veritabanına erişim, PHI ve şema bağımlılığı
  demek; HL7 arayüzü varken yanlış kapı.
- Kanıtsız iddia yok: "her şey buraya akıyor" cümlesi IT cevabı gelene kadar hipotezdir.
