# Homunculus · iş planı (web)

24.09.2026 · Madde madde takip `istekler.md`'de. Bu dosya büyük resim: ne bitti, ne sırada, ne sende bekliyor.
Hepsi tıklanabilir prototipte: http://localhost:5199/app/ · açarken **Ctrl+F5**. Gerçek ürünün koduna bu turda dokunulmadı.

## 1 · Bu oturumda bitenler ✅

| Alan | Ne yapıldı | Nereye bak |
|---|---|---|
| Devir | Paralel oturumların yarım işleri: cihaz ve bakım planı ekranları 4 dile çevrildi, LDAP eklendi | Dil değiştir → Cihazlar, Bakım planı |
| Giriş | Tek ekran, hareketli tanıtım, Caps Lock uyarısı, tema, hızlı giriş düğmesi, yasal sayfalar | Çıkış yap → giriş ekranı |
| Yasal | Gizlilik · Kullanım koşulları (tıbbi sorumluluk reddi) · Aydınlatma · Destek, 4 dilde | Giriş ekranının altı; Ayarlar → Yardım ve yasal |
| Üst çubuk | MedRapor düzeni; açılır dil listesi, tam ekran, kısayollar | Her ekran |
| Sol menü | Çubuk yalnız fare üstündeyken; düğmeler büyük | Admin ile gir |
| Monitör | Duvar monitörü sayfası, tam ekran tek hasta, nabız bipi + alarm sesleri | Menü → Duvar monitörü |
| Portatif | Siyah "aralıklı ölçüm" paneli: fark, mini eğri, eşik uyarısı | Acil servis hastası (ACI03) |
| Yazı tipi | Kalın yazılar tırnaklı yazıya düşüyordu; düzeldi | Her ekran |
| Form doldur | Açılmıyordu; düzeldi | Hasta ekranı |
| Yetki | Admin bütün ekranları görür; yetki tablosu yenileyince kaybolmuyor | Yönetim → Roller ve yetkiler |
| Notlar | "Hastanenin onayı gerekir" gibi notlar yalnız yöneticiye | Hemşireyle form aç |
| Kabul | Elle kayıtta hasta no + protokol, kol bandı | Kabul → Elle kayıt |
| Görevlerim | 24 saatlik ızgara ekranı dolduruyor | Görevlerim |
| Ayarlar | 7 sekme: görünüm, profil, güvenlik, bildirim, monitör sesi, kısayollar, yardım | Sağ alttaki Ayarlar |

## 2 · Şu an yapılıyor 🔧

1. **Birim panosu** (#76): hekim için grafikli sayfa. Risk ısı haritası, hasta başına eğriler, skor eğilimi, alarm yükü, laktat.
2. **Bakım kataloğu** (#79): tanı ekleme penceresi yenileniyor (öneri, kayıttan işaretli nedenler, faaliyet → Görevlerim). Yönetimde katalog düzenleme, içe aktarma ve sürüm.

## 3 · Sırada (senden bir şey gerekmiyor)

| # | İş | Neden önemli |
|---|---|---|
| a | Giriş sonrası durum ekranları: oturum zaman aşımı + 1 dk önce uyarı, "başka cihazdan girildi", yetkisiz sayfa, yeni sürüm şeridi | MedRapor'dan; paylaşılan istasyonda güvenlik |
| b | Hasta → Skorlar sekmesinde SOFA / NEWS2 eğilim grafiği | Hekimler grafik sever (#76 devamı) |
| c | Tablet görünümü (#39): 820–1180 px ölçümü ve düzeltmeler | Yatak başında tablet |
| d | İkon tarzı (#66): ikon setini sadeleştir, birkaç yerde ikon yerine renkli harf/sayı rozeti dene | Netlik |
| e | Taslak 15'e yeni fikirler (#24, #32): MedRapor'dan alınanlar + hastane ekranlarından | Yol haritası |
| f | Tasarım Masası'nı (http://localhost:5199/) bu oturumun kararlarıyla güncelle | Tek giriş kapısı |

## 4 · Senin kararını bekleyenler ⏳

| # | Karar | Nerede |
|---|---|---|
| 25 · 54 | **Marka kimliği** (renk + yazı tipi). Seçilince her yerde birden değişir | http://localhost:5199/16-marka-secimi.html → "Marka: A/B/C/D" yaz |
| 2 · 5 | Rol modeli ve 3 katman (tam / vital / operasyonel) onayı | Yönetim → Roller; Hastane yapısı |
| 8 | Telefona bildirim: yalnız kritik (kararın var) → gerçek üründe yapılsın mı? | Taslak 18 |
| 13 | Tanıtım sayfası için 3 karar | istekler.md en alt |
| 14 | Homunculus Türkçe proje wiki'si kurulsun mu? | — |
| 17 | Taslak 15'ten fikir seçimi (numarayla) | http://localhost:5199/15-sistem-neler-olabilir.html |
| — | AZ / RU / EN metinlerini yerel biri okusun (ajanların işaretlediği terimler listede) | — |
| — | Yasal metinleri hastanenin hukukçusu okusun | Giriş → Gizlilik vb. |

## 5 · Bekletilenler ⏸

- **Mobil uygulama** (#33, #34, #52): tasarım kararı verilmeden başlanmayacak (senin kararın).
- **Gerçek ürüne aktarma**: prototipte onaylanan ekranlar gerçek panele (dashboard) taşınacak. Bu ayrı bir faz; cihaz tarafıyla (Asaf) birlikte planlanacak.
