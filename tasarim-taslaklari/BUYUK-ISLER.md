# HBYS — Büyük İşler (genel bakış) · 2026-10-25

Sahip onay beklemeden hepsinin tamamlanmasını istedi. Dal: `hbys/gelistirme`. Bitince sahip tüm süreçleri gözden geçirecek.
Değişmez: kendi kod/isimlerimiz · Azerbaycan (SAMHI/TƏBİB, Medula yok) · her özellik yetkiye bağlı · ekranlar birbirine bağlı · 4 dil · ileride mobil.

## 1) Sol panel (modül ağacı) düzeni
**Amaç:** Sol menü, görsellerdeki modül ağacı mantığında, gruplanmış ve düzenli olsun.
- NAV'ı başlıklar altında grupla (Hasta & Klinik / Tedavi & Tanı / Finans & Vezne / Yönetim & Admin / Destek). Rol yetkisine göre yine filtrelenir.
- Gereksizleri (Türkiye'ye özel) dışarıda; eksik modülleri (varsa) başlık olarak.
- Mevcut çalışan ekranları bozmadan yalnız yerleşim/gruplama.

## 2) İK → kullanıcı oluşturma süreci (Güvenlik Tanımları)
**Amaç:** İK yalnız personel kartını açar; ADMIN o personele kullanıcı + yetki verir.
- İK: personel kartı (var, zenginleştirildi).
- Admin "Kullanıcılar": personelden kullanıcı oluştur (kullanıcı adı, şifre, açılış ekranı, şube, grup).
- Güvenlik Tanımları: **Yetkiler / Formlar (modüller) / Roller / Değerler (veri izinleri)** sekmeleri.
- **Yetki kopyalama:** başka kullanıcıdan rol/form/veri/fonksiyon yetkisi kopyala.
- Genelde role bağlanır (rolün yetki/modül/değerleri).

## 3) Zengin hizmet kartı (hizmet tanımı)
**Amaç:** Yeni hizmet/işlem tek karttan tanımlansın; var olanlar düzenlensin.
- Hizmet kartı: Kod, Ad, Yabancı ad, Tip/Alt tip, Fiyat+KDV, Maliyet, İndirim yetki kodu, Doktor seçim tipi, KDV muafiyet, Mesaj konusu, Rapor bölümü, Patoloji tipi, Şube, Süreler, Özellikler (teklifte çıkmasın/tam zorunlu/paket), Randevu, kategoriler.
- Kendi kod alanlarımız (SUT yerine); yeni hizmetler katalogda H.HIZMET yanında görünür.
- Admin "Hizmet Fiyatları" ile aynı yerden yönetim (tek nokta).

## 4) Çeviri turu (4 dil: AZ / TR / RU / EN)
**Amaç:** Sistemdeki tüm görünen metinler 4 dilde doğru.
- Sözlüğe (ceviri-sözlük) eksik HBYS terimlerini ekle (vezne, protokol, istem, randevu, rapor, İK, bölüm, hizmet, destek…).
- Ekranlarda İngilizce/anahtar sızması taraması; düzeltme.
- Dil değiştirince ekranların doğru çevrildiğini doğrula.

## 5) Vezne uçtan uca zincir
**Amaç:** Kayıttan tahsilata tam akış, parçalar birbirine bağlı.
- Kayıt (FİN ara → yoksa yeni kayıt) ✅ → otomatik hizmet (protokole düşer) → **doktor iş listesi** (Tüm Gelişler ✅) → doktor **tetkik/radyoloji istem** ✅ →
- Vezne **istek havuzu** (hastanın bekleyen işlemleri) → fiyat ✅ → **işlem havuzu** (seçilen işlemler) → **fatura kes / indirime gönder**.
- Vezneden tetkik isteği ✅. Geliş ikonları + kilit ✅.
- Kalan: İstek Havuzu ve İşlem Havuzu'nu hasta bazlı tam ekran + fatura kesme/indirim bağla.

## Sıra (önerilen)
1→ Çeviri (geniş etki, hızlı), 2→ Sol panel (yerleşim), 3→ Zengin hizmet kartı, 4→ İK→kullanıcı, 5→ Vezne uçtan uca.
Her biri parça parça, commit'lenerek, smoke testiyle. Bitince toplu gözden geçirme.
