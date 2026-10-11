# Tasarım prototipi — canlı sisteme alınmayan 14 madde

**Tarih:** 2026-10-09
**Kime:** Tasarımı yapan ekip
**Konu:** `tasarim-taslaklari/app/` prototipinin canlı sisteme taşınmayan kısımları

## Bağlam

Prototipin yerleşimi, renk düzeni, tipografisi, ikon seti ve dil sözlüğü canlı sisteme
olduğu gibi alındı — Dalga 1B'de tasarım temeli, Dalga 2'de giriş ekranları ve kabuk,
Dalga 3'te iş ekranları bu prototipe göre yazıldı. Bu belge **neyin alınmadığını** ve
nedenini anlatıyor; eleştiri değil, ayrım.

Ayrımın ölçütü tek: **canlı sistem hastanın gerçek verisini gösteriyor.** Prototipte bir
sayıyı göstermek tasarım kararıdır; canlı sistemde aynı sayıyı göstermek klinik bir iddiadır
ve kaynağı olmak zorundadır. Homunculus tanı koymaz; motorun hesapladığını ve gerekçesini
gösterir. Motorun söylemediği bir şeyi tarayıcı uyduramaz.

## Alınmayanlar

**Uydurulmuş klinik içerik — hiçbiri alınamaz.**

1. **Giriş sayfasındaki hareketli koğuş sahnesi,** içinde uydurma alarmlarla. Giriş ekranı,
   henüz kimliği doğrulanmamış birine gerçek görünen alarm gösteremez; canlı sistemin
   kapısında duran bir sahne, izleyen için gerçektir. Yerine iki doğru cümle kondu:
   "Qərarı həkim verir", "Məlumat xəstəxanada".
2. **İki "dikkat" kutusu sabit metinle:** "3 sonuç görülmedi · içinde 4.1 laktat",
   "1 cihaz sessiz · RE07, 6 dakika veri yok". Bunlar kodda sabit yazılı; gerçek bir laktat
   değeri gibi okunuyor.
3. **45 saniye sonra kendiliğinden gelen bildirim.** Sistemin bir şey fark ettiği izlenimi
   veriyor; hiçbir şey fark etmemiş oluyor.
4. **"84 ms" yanıt veren entegrasyon testi** — hiçbir yere sormuyor.
5. **Üretilmiş kalp sesiyle birlikte benzetilmiş EKG,** "temsili dalga formu" damgalı.
   Damga doğru ama yetmiyor: hasta başındaki bir ekranda temsili dalga, o hastanın dalgası
   sanılır.
6. **Bütün grafikler tohumlanmış rastgele üreteçten çiziliyor;** kırmızı "alarm aralığı
   dışında" bantları `core.js:499-501`'de sabit. Canlı sistemde grafik yok: motorda vital
   geçmişi uç noktası henüz yok (Grup 2). Boş eksen çizmek yerine yer ayrıldı ve neden
   olmadığı yazıldı.

**Tarayıcıda hesaplanan klinik değerler — motorun işi.**

7. **BMI ve vücut yüzey alanı tarayıcıda hesaplanıyor.**
8. **Ağrı, düşme riski ve bası yarası etiketleri** kodda sabit bantlardan türetiliyor.
9. **Hastane numarası ve protokol numarası hasta kimliğinden hesaplanıyor.** Gerçek
   hastanın gerçek dosya numarası değil; öyle görünüyor.
10. **3 / 5 / 10 dakikalık yükseltme merdiveni.** Prototipin kendi yönetim sekmesi bunun
    bağlı olmadığını yazıyor. Alarm ekranı artık motorun "yükseltildi" bilgisini olduğu
    gibi gösteriyor, merdiveni kendisi kurmuyor.

**Güvenlik ve kayıt — canlı sistemde çalışmaz.**

11. **Şifre kuralı tarayıcıda, üç ayrı ve birbiriyle çelişen sürümde;** ayrıca tarayıcı
    açık metin şifre üretiyor. Canlı sistemde kural sunucuda (en az 8 karakter) ve yalnız
    orada; yöneticinin araçları tarayıcının kuralını bilmez.
12. **Yetkiler `localStorage`'da tutuluyor ve yalnız tarayıcıda denetleniyor.** Bu, yetki
    denetimi değil görüntü; sunucu her istekte kendi denetler.
13. **Grup × yetki onay kutusu tıklandığı an uygulanıyor** — kaydet yok, işlem bütünlüğü
    yok. Canlı sistemde yetki değişikliği tek bir işlemde ve denetim kaydıyla olur.
14. **"Bu rolün gözüyle bak" anahtarı.** Yetkiyi taklit eden bir görünüm, denetim kaydında
    kimin ne gördüğünü belirsizleştirir.

## Sorumuz: üçü ürün müydü?

Yukarıdakilerin on biri demo iskelesi gibi duruyor — gösterim için konmuş, canlıda yeri
olmayan. Ama **üçü ürün kararı gibi duruyor** ve öyleyse kaynağıyla birlikte işe girer:

1. **Yükseltme merdiveni (10):** 3 / 5 / 10 dakika hastanenin kendi yükseltme politikası mı,
   yoksa örnek değer mi? Politikaysa kaynağı (hastane prosedürü, kılavuz) nedir? Motor
   tarafında yapılandırılabilir hâle getirilmesi gerekiyor.
2. **Alarm kalite sayıları (2):** "3 sonuç görülmedi", "1 cihaz sessiz" — bunlar gerçekten
   izlenmesi istenen ölçütler mi? İstenen buysa motorun bunları üretmesi gerekiyor;
   ekran sayabilir ama uyduramaz.
3. **Vital bantları (6):** `core.js:499-501`'deki "alarm aralığı" değerleri nereden geldi?
   Bir kılavuzdan geldiyse kaynağını alıp motora koyabiliriz; grafikler Grup 2'de gelecek ve
   o bantlar oraya ait.

## İki soru daha: yönetim ekranlarından

Yönetim ekranlarının planı yazılırken prototipin o bölümünde iki şey daha çıktı. İkisi de
yukarıdaki 11. ve 14. maddenin kapsamında ama ayrıca sormaya değer, çünkü ikisi de
"böyle olsun" diye konmuş olabilir:

4. **Tarayıcının ürettiği açık şifre.** Prototipte yeni kullanıcı formu şifreyi kendisi
   üretip ekranda gösteriyor. Canlı sistemde geçici şifreyi yönetici giriyor ve kullanıcı
   ilk girişte değiştirmek zorunda (göç `0011`). Soru: şifreyi sistemin üretmesi istenen bir
   davranış mıydı? İstenen buysa sunucu tarafında üretilip tek kullanımlık gösterilmesi
   gerekir — tarayıcıda üretilen bir şifre denetim kaydına girmez ve kimin gördüğü bilinmez.
5. **"Bu rolün gözüyle bak" anahtarı.** Yönetim sekmesinde bir rolü seçip arayüzü o rolün
   gördüğü gibi görme özelliği var. Canlı sistemde bu, denetim kaydında kimin ne gördüğünü
   belirsizleştirir. Soru: amaç yetki denetimini sınamak mıydı? Öyleyse doğru yeri ayrı bir
   "yetki önizleme" ekranı olur — gerçek oturumu değiştirmeden, hangi rolün hangi ekranı
   açabildiğini listeleyen, salt okunur bir görünüm.

## Not

İlk üç sorunun cevabı Grup 2'yi şekillendiriyor (vital grafikleri, yükseltme politikası,
alarm kalitesi); son ikisi yönetim ekranlarını. Geri kalan maddeler için bir şey yapılması
gerekmiyor — bilgi olarak yazıldı ki aradaki fark bir kod karşılaştırmasından değil buradan
öğrenilsin.
