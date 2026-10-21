# HBYS — Kalan İşler Faz Planı (onay bekliyor)

Bu plan, bu sohbette verdiğin ama **henüz bitmemiş** işleri fazlara ayırır.
Sen onaylayınca ajan **hiç bilgi beklemeden** hepsini sırayla bitirir; bitince sen tekrar bakarsın.
(Biten işler `ISTEKLER.md`'de; bu plan sadece kalanlar.)

Tarih: 2026-10-22 · Dal: `hbys/gelistirme`

---

## Faz A — Doktor muayene ekranını tamamla
Muayenenin büyük kısmı bitti (özgeçmiş/soygeçmiş yapısal, psikolojik durum, ağrı, tedavi tipi, ICD tanı tipi/ana tanı, fizik vital). Kalan:
- **A1.** Bölüme göre **detaylı muayene bulguları** — mekanizma (muayenede "Detaylı muayene bulguları" düğmesi + branş seçimi) + **Göz** formu örnek (OD/OS: refraksiyon, GİB, görme keskinliği, gözlük bilgileri, biyomikroskopi, fundus, takip bulguları). Diğer branşlar sırayla. (#358)
- **A2.** Taburculuk önerileri alanı (taburcu tipi + not).

## Faz B — Ayaktan akışının omurgası (en önemli)
- **B1.** **Otomatik Hizmet Tanım Listesi** (admin): bölüm → muayene hizmeti + geliş tipi + protokol tipi eşlemesi. Kabul bir bölüme/doktora kayıt açınca o muayene hizmeti otomatik düşer. (#353)
- **B2.** **Tüm Gelişler / İş Listesi (Hastalarım)**: doktorun ana giriş ekranı — hangi hasta ne amaçla gelmiş (protokol), lab/radyoloji ilerleme, durum, "Göreve git". (#342/#354)
- **B3.** Ayaktan / günübirlik / yatan ayrımının bu akışa düzgün oturması. (#355)

## Faz C — Doktor modül menüsü (eksik ekranlar) + şablon
- **C1.** Ameliyat Raporu ekranı (şu an dış link uyarısı veriyor).
- **C2.** Protokol İşlem, Randevu Geçmişi, "Yatış" ekranı düzeni (yatan hasta izlem notu + hemşire gözlem notu bir arada).
- **C3.** **Şablon süreci yeniden**: muayene üstünde "Şablon Seç / Şablonlara Ekle", şablon kapsamı **Benim / Bölümüm / Tümü**, "İsteme Dönüştür" / "Şablona Kopyala". (#333/#335)

## Faz D — Tanımlar (admin) + reçete
- **D1.** **İlaç reçetesi** zengin ekranı: reçete türü (yeşil/mor/turuncu/kırmızı/normal), alt tür, ICD tanı bağlama, ilaç satırı (ad/barkod/miktar+birim/sıklık/periyot/kullanım şekli/açıklama türü), etkileşim sorgu. e-Nabız yerine Azerbaycan muadili. (#332)
- **D2.** **Protokol tipleri** tanım ekranı (bayraklarıyla). (#348)
- **D3.** **Bölüm listesi** + **Branş listesi** (veri dosyası gelince — ICD/hizmet gibi). (#344)
- **D4.** **Rapor/çıktı şablon** alanı: Taahütname, Anestezi Değerlendirme, Tetkik İstem gibi formlar. (#349)
- **D5.** İlaç / malzeme listesi (sen verince yüklenir). (#339)

## Faz E — Diğer roller (daha önce "sonra" dediğin kısım)
- **E1.** Hasta Kabul / **Hasta 360** tamamlama (FİN, sigorta/kurum, KVKK-ETK onayı, adres). (#350)
- **E2.** **Randevu** modülü (poliklinik/cihaz/diş/FTR takvimi + randevu geçmişi). (#343)
- **E3.** **Vezne / Faturalama** + SAMHI (zorunlu sığorta) — Azerbaycan muadili. (#345)
- **E4.** **Lab / Radyoloji sonuç iş akışı**: istem → numune/çekim → uzman onay → serbest bırak. (#346)
- **E5.** **İK** modülü (personel kartı, SGK/izin, kadro). (#351)

## Faz F — Yetki + çeviri + cila (sürekli, her fazla birlikte)
- **F1.** Her yeni ekran/istem türü için **admin yetki ucu** (hangi rol yapabilir). (#336)
- **F2.** **Çeviri** eksiklerini tam denetle ve doldur (AZ/RU/EN). (#323)
- **F3.** **Seçim/form ekranlarını** baştan sona denetle (net görünüm). (#341)

---

## Kurallar (tüm fazlarda geçerli)
- İsimler bize özgü (rakip metinleri birebir kopyalanmaz); kendi kodlarımız (00001…).
- Türkiye'ye özgü SUT/e-Nabız yok; Azerbaycan muadili (TABIB/e-səhiyyə/SAMHI) netleşince.
- Her özellik iki taraflı: kullanıcı ekranı + admin yetki tarafı.
- Sistem tanı/doz koymaz, öneri sunar.
- Canlıya alırken yalnız test verileri silinir; çalışmalar korunur.

## Önerilen sıra
A → B → C → D → (E) → F birlikte. Faz E (randevu/vezne/İK) daha büyük ve "diğer roller"; istersen onu en sona bırakıp önce A–D'yi bitiririz.
