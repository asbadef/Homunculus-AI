---
tip: cikti
tags: [ana-sayfa, tasarim, elestiri, karar, homunculus]
ozet: 24.09 ana sayfa sürecinin eleştirisi — iyi / kötü / eksik / geliştirilecek; tasarım süreci, görseller, geçişler, akış için net kararlar; "nöbet" yerine 7/24 yoğun bakım konumu.
guncelleme: 2026-09-24
---

# Ana sayfa · süreç eleştirisi ve kararlar (24.09.2026)

Okuyan: Ozan. Amaç: bu zamana kadar ne iyi gitti, ne kötü gitti, ne eksik; bundan sonra nasıl çalışacağımızı sabitlemek.

## Konum: "nöbet" değil, 7/24 yoğun bakım

Sorun yerinde. Sayfa ürünü "bir gece nöbeti" üzerinden anlatıyordu; ama yoğun bakım 7/24 çalışır, ürün de nöbet aracı değil. Homunculus'un doğru tanımı:

> **Yoğun bakım için klinik karar destek ve yönetim sistemi.** Birimin tamamını tek ekranda toplar, kötüleşmeyi erken gösterir, haberi doğru kişiye taşır, her adımı kaydeder; kararı hekim verir. Yönetim tarafında doluluk, iş yükü, cihaz, kalite ve denetim kaydı aynı sistemdedir.

"Sadece yönetim sistemi" demek eksik olur, çünkü değerin yarısı yatak başında, yani klinik karar desteğinde. "Sadece karar destek" demek de eksik, çünkü prototipte kabul, cihaz, bakım takvimi, iş yükü, kalite ve pilot raporu var. İkisi birlikte doğru.

**Uygulandı:** üst etiket "Yoğun bakım için klinik karar destek ve yönetim sistemi". "Bir nöbet" bölümü **"24 saat"** oldu: sabahtan ertesi sabaha, gündüz ve gece. Devir anları kalıyor, çünkü devir yoğun bakımın gerçeği; ama çerçeve artık nöbet değil, gün.

## İyi giden

- **Tek taban seçildi, dağılma bitti.** 6 yön → "Girişin devamı" + "Ürün turu". Giriş ekranıyla ana sayfa artık aynı ürün gibi duruyor.
- **Gerçek özellik anlatılıyor, uydurma yok.** Kahramandaki ve "Neler var"daki her madde prototipte açılan bir ekran; sayılar sayıldı (8 rol, 19 ekran). "Sonuç iddiası" (yüzde, süre kazancı) yok. Klinik bir ürün için doğru duruş.
- **Hareket anlam taşıyor.** Kahramandaki canlı birim kartı (REA03 kötüleşir → hemşire → sorumlu → hekim) ürünün özünü tek bakışta anlatıyor. Süs animasyonu değil.
- **Parçalı yapı.** Tur ve 24 saat ayrı dosyalar (`parca/`); biri değişince sayfa bozulmuyor.
- **Dört dil baştan.** Her yeni metin AZ/TR/RU/EN giriyor; sonradan çeviri borcu birikmiyor.

## Kötü giden (benim hatam olanlar dahil)

- **Önbellek yüzünden "değişmedi" sandın.** Sunucu önbellek başlığı göndermiyordu; tarayıcı eski sayfayı gösterdi. Zaman kaybettirdi. → Düzeltildi: `sunucu.py` her yanıta "no-store" ekliyor.
- **Yarım dosya açıldı.** Bir kez sayfa iki düzenlemenin arasında açıldı ve boş göründü. → Kural: büyük değişiklik önce `yeni.html`de denenir, test geçince ana dosyaya kopyalanır.
- **MedRapor'u kopyaladık.** Alt bilgi birebir MedRapor düzeniydi. Sen "mantığını al, stili bizim olsun" dedin; haklıydın. → Alt bilgi yeniden: koyu petrol zemin, üstünde yatak başı monitörü çizgisi, ilkeler, birim etiketleri.
- **İkon dili zayıf.** İnce çizgi ikonlar her yerde aynı görünüyor, ürünü anlatmıyor. → Karar aşağıda.
- **Uzun kaydırmalı hikâye yorucuydu.** "Bir nöbet" bölümünde fareyle sürekli kaydırmak gerekiyordu, altında boşluk kalıyordu. → Kendi kendine ilerleyen, hızı seçilebilen 24 saatlik oynatıcıya dönüyor.
- **Başlıklar sende yankı bulmadı.** "Kötüleşmeyi erken görün — karar hekimde kalsın" zayıf kaldı. → 20 öneri, canlı seçim sayfasında.

## Eksik

- **Gerçek ekran görüntüleri.** Sayfa ürünü çizimlerle anlatıyordu. → Prototipten otomatik çekilen görüntüler (aşağıda).
- **Hastanenin gerçek adı ve logo.** Hastane adı şimdilik "Klinik Xəstəxana"; marka kimliği sende (Taslak 21).
- **Yazı tipleri Google'dan geliyor.** Çerez bırakmıyor, ama "veri hastanede" iddiası için gerçek üründe yazı tipleri hastanenin kendi sunucusundan gelmeli.
- **İletişim formu yok.** "Pilot için görüşelim" şimdilik Destek sayfasına gidiyor. Gerçek form gerçek üründe (gönderim sunucu işi).
- **Müşteri kanıtı yok.** Referans, alıntı, pilot sonucu yok, olmamalı da: pilot bitmeden yazılmaz. Yeri hazır, "Pilot" bölümü.

## Net kararlar

| Konu | Karar | Neden |
|---|---|---|
| Görsel dil | **İkon yerine gerçek ekran görüntüsü.** Prototip her değiştiğinde tek komutla yeniden çekilir (`tanitim\gorsel\cek.cjs`), 4 dil × 2 tema | Yapay zekâ görseli ürünü olduğundan farklı gösterir ve zamanla gerçekle çelişir; gerçek ekran hiç yalan söylemez |
| Canlı parçalar | Kahraman kartı, tur ekranları ve monitör çizgileri **HTML ile canlı** (resim değil) | Dil ve tema değişince kendiliğinden uyar; veriler akar |
| İkonlar | Yalnız düğme ve küçük etiketlerde; anlatım yüklü yerde yok | İkon kavram anlatmaz, yer tutar |
| Geçişler | 3 tür, hepsi kısa: bölüm girerken yumuşak belirme, sekme/rol değişiminde kayma, canlı kartta durum değişimi. Hareket azaltma ayarında hepsi kapanır | Klinik ürün sakin görünmeli; hareket yalnız bilgi taşırken |
| Akış | Sorun → Nasıl çalışır → Ekranlar (tur) → 24 saat → Kimler için → Birimler → Kim ne görür → Güven (yapar/yapmaz) → Pilot | Önce "neden", sonra "nasıl", sonra "kanıt", en sonda "güven + adım" |
| Genişlik | İçerik 1680 px'e kadar; kenar payı ekranla büyür | 1920'de iki yanda 370 px boşluk kalıyordu |
| Üst çubuk | 5 başlık (Nasıl çalışır · Ekranlar · 24 saat · Kimler için · Güven) + Pilot + Kullanıcı girişi; seçili bölümün altında kayan gösterge; "Ana sayfa" işini logo görür | 7 başlık kalabalıktı, "Ana sayfa" gereksizdi |
| Çerez | Alttan tam genişlik şerit; 15 sn sonra kendiliğinden kapanır (üstündeyken bekler); **"Tümünü kabul et" yok** | Takip çerezi yok; kabul ettirilecek bir şey yokken kabul düğmesi koymak yanıltır. Bilgi verilir, geçilir |
| Adresler | Sayfa `…/anasayfa/`; bölümler Türkçe: `#nasil-calisir`, `#ekranlar`, `#24-saat`, `#neler-var`, `#guven`, `#pilot` | Adreste ne olduğu okunmalı |
| Tasarım süreci | Seçim bitti; yeni "6 yön" üretilmez. Bundan sonra aynı sayfa üzerinde **küçük seçimler** (başlık gibi) canlı seçim sayfasıyla | Seçim yorgunluğu; karar hızlanır |

## Bundan sonra nasıl çalışıyoruz

1. Sen ekran görüntüsü + bir cümle atarsın; ben önce **dosyayı okurum**, sonra değiştiririm.
2. Seçim gereken yerde (başlık, renk) canlı seçim sayfası; numarayı yazarsın.
3. Her tur sonunda **Yapıldı / Çizildi / Bekliyor** ayrı yazılır; "nereye bak" satırı her maddede.
4. Değişiklik görünmüyorsa önbellek değil: sunucu artık önbelleksiz. Yine de görünmüyorsa bana yaz, ben ölçerim.
