# Görsel Backlog — tek liste (bu sohbetteki tüm ekran görüntüleri) · 2026-10-25

**Amaç:** Sahibin bu sohbette verdiği 236 görselin hepsini tek yerde takip etmek. Her ekran bir madde; `[x]` biten, `[ ]` bekleyen. Görselleri partiler halinde işleyip ilgili maddeye numara(lar)ını yazıyorum (`#NNN`). İlke sabit: kapsam birebir, görsel kimlik bizim; Medula yok; entegrasyonlar (Omnitech/SAP/VNA/ComedEMR/UHM) etiketli yer tutucu; kendi kod/isimlerimiz.

**Kaynak görseller:** `…/images/1.png … 236.png` (oturum klasörü).
**İşleme durumu:** kataloglama sürüyor — aşağıdaki maddeler bilinen ekranlardan seedlendi; görsel numaraları işledikçe eklenecek.

---

## FAZ V — VEZNE (öncelik)
- [x] Hasta Dosyası iskeleti + üst bar + ana/alt sekmeler
- [x] Hasta Kartı sekmesi (Kimlik/demografi · Belge-adres · İletişim · Kurumsal)
- [x] Hasta Kartı düzeni: çok sütunlu, derli toplu form (alt alta uzama giderildi) · #236
- [x] Gelişler sekmesi (Geliş/Hekim/Arşiv/Kurum/Takip/Yurtdışı/Yatış kartları)
- [x] Faturalar (sütunlar + sağ-tık menüsü)
- [x] Ödemeler/Avanslar (sütunlar + sağ-tık)
- [x] İndirimler (sütunlar + sağ-tık)
- [x] Dosyalar/Resimler (sütunlar + sağ-tık)
- [x] Notlar (sütunlar + sağ-tık)
- [x] Teklifler (Ameliyat/Tüm + teklif hizmetleri + sağ-tık)
- [x] Online Ödemeler / POS / Anlaşmalarım — gerçek tablolar + sağ-tık
- [x] Vezne Paneli: üst bar (Banko/Dönem/Tarih) + çoklu arama + arama detay + liste sütunları (client-side filtre)
- [x] Hasta Ön Kayıt: admission ekranı (yatak/eşleştir/elle) + vezne listesi sağ-tık (Dosya/Birleştir/Kabul türleri/Yeni Doğan/Protokol)
- [x] İş Havuzu: İstek Havuzu
- [x] İş Havuzu: **İşlem Havuzu** zengin (toolbar Fatura/Parçalı/İndirim/Provizyon/Panel paket + Fatura Bekleyen/Tümü + kurum etiketi + sağ-tık)
- [x] İş Havuzu: İstek + Provizyon Takip / Randevular / Yatış İstekleri / Onam Formları / Tetkik Havuzu / Arşiv (ana sekme 8 alt sekme)
- [x] Kasa / Dönem: banko seç + dönem Aç/Kapat/**Devir Al** + **Dönem özeti** (nakit/kart/havale)
- [~] Toolbar "Diğer" 16+ madde → modal (küçük form); önemli olanlara tam ekran sonra
- [x] KVKK/ETK onay → SMS/mail gönderim modalı
- [x] Sağ ray tam set: Fiyat verme/Kampanyalar/Dönem bilgileri/UHM/Onam/İade taleplerim/Toplu fatura/Randevulanacak hizmetler/Hasta danışman/Kurum değişiklik — hepsi aktif (liste/rota)
- [x] İnce-taneli vezne yetkileri admin matrisinde (kapalı protokolde ekle/sil, tahsilat değiştir, protokole aktar, fatura iptal, avans, kurum değişiklik, toplu fatura)
- [x] **Kurumsal Faturalama çok panelli ekran (#61)** — vezne sekmesi + sağ ray; sol kurum fatura listesi + 8 dikey sekme (Kalemler/İşlemler/Protokoller/Vezne/Evrak/İcmal/Notlar/Klinik Dök.); icmal CSV, not ekleme (2026-10-25)

## FAZ T — TEDAVİ / DOKTOR (2026-10-25 · çekirdek tamamlandı)
- [x] **Tedavi sekmesi** (hasta360): Klinik Dokümanlar (muayene/epikriz/izlem editörü — docs.js) / Laboratuvar / Radyoloji / Patoloji / **Tanılar (ICD ara-ekle)** / Reçete-ilaç; Arşiv sekmesi aktarım tablosu
- [x] Doktor iş listesi → istem (İş Havuzu · İstek) → epikriz (docs muayene notu, şablona göre) akışı yüzeye çıktı
- [~] Doktor girdiği hizmet/tarih düzenleme — yetki (`protokol_duzenle`) tanımlı; derin düzenleme UI'si ileride
- [ ] Diş tedavi planları · branşa özel detaylı muayene formları (şimdilik Göz formu hazır) — ileride

## YENİ (2026-10-25, 2. büyük tur — #239-296 + yetki.xls)
- [x] **Tek hasta kartı → çok protokol** modeli: Hasta Dosyası'nda sol tarih-gruplu protokol listesi (İki hafta önce/Son ay/Daha eski) + "TÜMÜ"; Gelişler/Faturalar/Ödemeler/İndirimler/Dosyalar/Notlar seçili protokole göre
- [x] **Güvenlik Tanımları** 4 sekme (Yetkiler/Formlar/Roller/Değerler) + `yetki.xls`'ten 927 ince-taneli yetki katalogu (`YETKI-KATALOG.txt`, `yetki-katalog.js`)
- [x] Cihaz Listesi (#31-33) · Değişken/Parametre Tanımları (#22)
- [x] Personel kartı tam sekme seti (Nöbet-Mesai-İzin/Eğitim-Tecrübe/Çalışma takvimi/Yakınları/Zimmet/Diğer Özellikler + fonksiyon yetkileri)
- [x] Raporlar: +Yönetim/İK/Kurum grupları + rapor modalı tarih/bölüm/doktor filtre + Yazdır
- [x] Vezne sağ ray tam set (tümü aktif) + ince-taneli vezne yetkileri admin matriste
- [x] Kurumsal Faturalama çok panelli (#61) — tamamlandı
- [x] Branş min/max yaş + kendi kodlar (BOL-NNN) · SGK→SAMHI etiketi · Doktor Muayene ekranı (FAZ T) ertelendi

## FAZ A — ADMIN / YETKİ / TANIMLAR
- [x] Roller ve yetkiler: canlı rol×yetki matrisi (kalıcı) + **Yetki Kopyalama** (kaynak→hedef) · kullanıcı kartı userModal (personelden doldur, yetki kopyala, açılış ekranı) mevcut
- [~] Güvenlik Tanımları ayrı "Formlar/Değerler" sekmeleri — mevcut matris Yetkiler+Roller'i karşılıyor; Formlar (modül erişimi) ve Değerler (veri izni) ayrı görünüm sonra
- [x] Personel kartı: Genel/Kişisel/Çalışma-takvim (görsel haftalık)/İletişim/Yetkiler sekmeleri
- [x] İzleme menüsü mevcut: Sistem durumu / Olay günlüğü / Veri bütünlüğü / Açık oturumlar + Denetim kaydı (Finansal veri izleme sonra)
- [x] Bölüm (idari+klinik) tanımı · [x] Protokol Tipi · [x] Hizmet Kartı/Fiyatları (birleşik) · [x] Otomatik Hizmet Tanımı · [x] Epikriz · [x] Kampanya · [x] Doküman · [x] Rapor Yetkileri · [x] ICD Tanı Listesi
- [x] **Cihaz Listesi** (RIS/ÖKC/çağrı ekranı · IP/MAC/port · ekle-düzenle-sil) (#31-33)
- [x] **Değişken / Parametre Tanımları** (para birimi/KDV/dil/randevu/dönem/oturum) (#22)
- [x] Branş/bölüm: min/max yaş + kendi kodlarımız (SUT yok, SGK→SAMHI) + Ayaktan/Yatan epikriz şablon eşleme (#334)
- [x] **Hizmet Kartı zengin sekmeler (#357-358)**: Genel + Tarifeler / Paketler / Bağlı işlemler / Kategoriler / Bölüm-personel / Verilme yeri / Kurallar
- [x] **Güvenlik Tanımları grup-ağaçlı seçim penceresi (#363-366)** (Yetki/Form/Veri "Ağaçtan seç" + yetki arama) · Kullanıcı kartı "Erişim bilgileri (dış sistem)" (#362)
- [x] **Raporlar**: +8 yönetim raporu gerçek veriyle doldu (Tahsilat/Ciro/Yatan hasta/Yatak doluluk/Doktor işlem/Personel/KVKK demografi/Taburcu)

## FAZ R — RAPORLAR
- [x] Rapor başlıkları (modül bazlı menü)
- [ ] Öncelikli raporların içi + filtre + Excel/Yazdır (birikecek)

## FAZ G — ÇERÇEVE
- [x] Sol panel düz (başlıksız) · [x] +Yeni üst bar (rol gözüyle) · [x] Üst bar (dil/tema/bildirim/saat) · [x] Destek/İş Takip
- [ ] Çeviri turu (4 dil) — sürekli · [ ] PWA/mobil — ileri faz

---

## KATALOGLAMA — TAMAMLANDI (2026-10-25)
236 görselin tamamı 3 agent ile kataloglandı:
- `GORSEL-KATALOG-A.md` (#1–#80) · `GORSEL-KATALOG-B.md` (#81–#160) · `GORSEL-KATALOG-C.md` (#161–#236)
Sonuç: referans sistem **CoMED web + "Pusula" masaüstü** (MLP Care). Tüm ekranlar yukarıdaki fazlara düşüyor; planda olmayan sürpriz yok. Not: #58 bizim GitHub, #59/#236 bizim web prototipimiz.

En yüksek eforlu/kritik referans ekranlar (ileride detay):
- Muayene ekranı (#12,#14,#91,#122) → FAZ T (doktor, ertelendi)
- Güvenlik/Yetki mimarisi (#18-21,#198-202) → matris + yetki kopyalama yapıldı; ince-taneli vezne izinleri (indirim/kapalı protokolde ekle-sil/tahsilat değiştir) PERMS'e eklenebilir
- Kurumsal Faturalama çok panelli (#61) → vezne faturalar genişletilebilir
- ICD Tanı Listesi 14891 kayıt (#35-57) → admin ICD listesi mevcut
- Branş/Cihaz Listesi (#25-33) → bölüm listesi var; Cihaz Listesi (RIS/IP/MAC) eksik
- Personel kartı çok sekme (#125-132,#203-208) → temel sekmeler + haftalık takvim yapıldı
