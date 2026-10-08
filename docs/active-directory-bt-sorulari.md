# Active Directory ile giriş — hastane BT birimine sorulacaklar

**Tarih:** 2026-10-08
**Kime:** Hastane bilgi işlem / sistem yöneticisi
**Konu:** Homunculus'a hastane Active Directory hesaplarıyla giriş

## Bağlam

Homunculus yoğun bakımda çalışan bir karar destek sistemidir; hastanın monitör verisini
okur, klinisyene gerekçeli uyarı gösterir. Tanı koymaz, tedavi değiştirmez.

Şimdiye kadar sistemin kendi yerel kullanıcı hesapları vardı. Yeni sürümde klinisyenler
**kendi hastane hesaplarıyla** (Active Directory) girecek. Bunun anlamı:

- Klinisyen ayrı bir şifre taşımaz, hatırlamaz.
- Hastaneden ayrılan birinin hesabı AD'de kapatıldığı an Homunculus'a da giremez.
- **Homunculus AD şifresini saklamaz.** Şifre yalnız o anki giriş için etki alanı
  denetleyicisine iletilir, doğrulamayı AD yapar. Veritabanımızda AD şifresinin hiçbir
  biçimi (açık, şifrelenmiş ya da özet) tutulmaz.
- Bağlantı LDAPS (TLS) ile kurulur; sertifika doğrulaması kapatılamaz, üretim modunda
  sistem bunu reddeder.

Aşağıdaki bilgiler olmadan AD girişi açılamaz. Yerel hesaplarla sistem çalışmaya devam
eder, ama o zaman klinisyen ikinci bir şifre taşımak zorunda kalır.

## A. Bağlantı

1. **LDAPS adresi nedir?** `ldaps://<ad>:636` biçiminde, etki alanı denetleyicisinin
   **sertifikasındaki DNS adıyla** — IP adresi ile bağlanınca sertifika doğrulaması
   başarısız olur.
2. **Denetleyicinin sertifikasını imzalayan kök sertifika (CA) dosyasını alabilir miyiz?**
   Kurum içi bir CA ise onun sertifikası gerekiyor.
3. **Homunculus sunucusundan (`172.100.101.72`) denetleyiciye 636 portu açık mı?** Kapalıysa
   açılması gerekiyor.
4. **Etki alanında birden fazla denetleyici var mı?** Varsa kaç tane ve hangisi öncelikli?

## B. Servis hesabı

5. **Salt okunur bir servis hesabı açılabilir mi?** (bind DN + şifre) Bu hesap hiçbir şey
   değiştirmez, yalnız okur. Okuması gereken alanlar:
   - `memberOf` — kişinin hangi gruplarda olduğunu, yani Homunculus'taki yetkisini belirler;
   - `accountExpires` — hesabın süresi dolmuşsa girişi reddetmek için;
   - `pwdLastSet` — kişi şifresini değiştirdiğinde eski oturumlarını kapatmak için.

   Bu üç alan okunamazsa sistem çalışır, ama **kapatılan ya da süresi dolan bir hesabı
   fark etmesi gecikir** — hasta güvenliği değil, bilgi güvenliği açısından sakıncalı.
6. **Servis hesabının şifresi için bir geçerlilik süresi / değiştirme politikası var mı?**
   Varsa süre dolduğunda giriş tamamen durur; önceden haber verilmesi gerekiyor.

## C. Kullanıcılar ve gruplar

7. **Arama kökü (base DN) nedir?** Hem klinisyen hesaplarını hem eşlenecek grupları
   kapsaması gerekiyor (ör. `DC=hastane,DC=local`).
8. **Homunculus'taki rollere karşılık gelen AD grupları hangileri?** Örnek eşleme:

   | Homunculus rolü | AD grubu (sizin doldurmanız gerekiyor) |
   |---|---|
   | Sistem yöneticisi | |
   | Sorumlu hekim | |
   | Ünite hekimi | |
   | Yoğun bakım hemşiresi | |
   | Biyomedikal / teknik | |

   Böyle gruplar yoksa açılması gerekiyor; kişiyi gruba eklemek/çıkarmak Homunculus'taki
   yetkisini değiştirmenin tek yolu olacak.
9. **Kullanıcı adları (sAMAccountName) yalnız ASCII harf mi içeriyor?** İçinde ş, ç, ğ, ö, ü
   geçen kullanıcı adları varsa bunları ayrıca ele almamız gerekiyor.
10. **Adında `#` veya `=` geçen AD grubu var mı?** Varsa o grupların eşlenmesi için ek iş
    gerekiyor.

## D. Hesap kilitleme politikası — dikkat gereken madde

Homunculus, hatalı şifre denemelerini AD hesabı kilitlenmesin diye sınırlar: bir hesap için
**en çok 3 hatalı bağlanma** yapar (son hatadan 15 dakika sonra sayaç sıfırlanır). Yönetici
kilidi açarsa 3 deneme daha tanınır — yani en kötü durumda **3 + 3 = 6**.

11. **Etki alanının hesap kilitleme eşiği kaç?** **En az 7 olması gerekiyor.** 6 ya da daha
    düşükse, Homunculus kendi sınırına ulaşmadan AD hesabı kilitlenebilir — klinisyen
    vardiya ortasında hem Homunculus'a hem hastane hesabına giremez hâle gelir.
12. **Sayaç sıfırlama süresi (reset account lockout counter after) kaç dakika?** **En çok 15
    dakika olmalı**, tercihen daha kısa. Daha uzunsa AD önceki denemeleri sayarken bizim
    sayacımız yenilenir ve hesap beklenmedik şekilde kilitlenebilir.
13. **Birden çok denetleyici varsa:** bir denetleyicide başarılı giriş, PDC öykünücüsünün o
    hesap için tuttuğu hatalı şifre sayacını sıfırlıyor mu? Sıfırlamıyorsa yukarıdaki
    hesabı yeniden gözden geçirmemiz gerekiyor.

## E. Ağ

14. **Koğuştaki bilgisayarlar tek bir NAT adresi ya da terminal sunucusu arkasında mı
    internete/sunucuya çıkıyor?** Homunculus giriş denemelerini IP adresi başına sınırlar
    (dakikada 10). Bütün koğuş aynı adresten görünüyorsa vardiya değişiminde eş zamanlı
    girişler bu sınıra çarpabilir; o durumda sınırı o adrese göre ayarlarız.

## Not

Bu cevaplar gelmeden AD girişi hastane sunucusunda açılamaz (projede G1-15 adımı). Cevaplar
geldiğinde yapılacak iş, bir yapılandırma dosyasını doldurup iki test hesabıyla doğrulamaktan
ibarettir — kod tarafı hazır ve test edilmiş durumda.

11. ve 12. maddeler politika sorusu olduğu için en uzun sürebilecek olanlar; mümkünse
önce onlara bakılması işi hızlandırır.
