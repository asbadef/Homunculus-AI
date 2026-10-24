# HBYS — Faz Planı 6: Destek, yetki/kullanıcı süreci, personel, sol panel (2026-10-24)

Geri alma yok. Dal `hbys/gelistirme`. Çapraz ilke: her özellik yetkiye bağlı · kendi kod/isimlerimiz · Azerbaycan (SAMHI/TƏBİB, Medula yok) · ekranlar bağlı · ileride mobil · çeviri sürekli kontrol.

## Faz Z — İş Takip / Destek Talebi (YENİ, sahibin istediği)
- Z1. Sahadaki kullanıcı (doktor/hemşire/vezne…) sorununu iletebileceği **Destek / İş Takip** ekranı: + Yeni talep (kategori, konu, açıklama, öncelik, ilgili modül). Kendi taleplerini görür.
- Z2. Bilgi Sistemleri / IT yöneticisi tüm talepleri görür; durum değiştirir (Açık→İşlemde→Çözüldü→Kapalı), not ekler, atar. Yetki: destek_ac (herkes), destek_yonet (IT/sistem).

## Faz AA — Kullanıcı/yetki süreci (İK → kullanıcı oluşturma)
- AA1. Süreç: İK personel kartı açar → admin/yönetici o personele **kullanıcı** oluşturur (Güvenlik Tanımları): Yetkiler / Formlar (modüller) / Roller / Değerler (veri izinleri). Genelde bir **role** bağlanır.
- AA2. Kullanıcı kartı alanları (görsel): Personel, Açılış Ekranı, Kullanıcı Adı, Şifre, Güvenlik Şifresi, Kullanıcı Grubu, Şube, Yetki Kopyalama (başka kullanıcıdan rol/form/veri/fonksiyon kopyala), Erişim Bilgileri (SMS/ComedEMR login).
- AA3. Admin rol kartı: rolün yetkileri + görebildiği formlar/modüller + değer (veri) izinleri (ör. Protokol açabileceği bölümler/hekimler, görebileceği raporlar, indirim onay grupları…). Sade, admin rahat yönetir.

## Faz AB — Personel kartı (İK) tamamlama
- AB1. Sekmeler (görsel): Genel, Kişisel, Nöbet-Mesai-İzin, Eğitim-Tecrübe, **Çalışma Takvimi + Randevu Özellikleri**, Yakınları, Zimmet, Diğer. Eksik alanları ekle.
- AB2. Çalışma Takvimi/Randevu Özellikleri doktora bağlı: randevu çizelge süresi, saatlik/günlük/aynı tarih randevu sayısı, web/online/poliklinik randevu, kurum tipi → **randevu tanımına bağlanır (Faz U/Madde 4)**.

## Faz AC — Sol panel (modül ağacı) düzeni
- AC1. Görseldeki modül ağacını (Hasta Kabul, Tedavi, Laboratuvar, Tetkik/Radyoloji, Stok, Eczane, Satın Alma, Sterilizasyon, Finans, Hakediş, İK, Randevu, Medikal Muhasebe, Tıbbi Arşiv, Kalite, İstatistik, CRM, Dijital Arşiv, Döküman, E-Nabız, Entegrasyon, Sistem…) bizim yapıya uyarlama; gereksizleri (Medula/Türkiye'ye özel) çıkar, eksikleri ekle. Modül bazlı erişim yetkiye bağlı.

## Faz AD — Bölüm/Branş büyük genişletme
- AD1. İdari birimler (Başhekimlik, İK Müdürlüğü, Bilgi Sistemleri, Mali İşler, Satınalma, Kalite, Hasta Hakları, Fiyatlandırma, Anlaşmalı Kurumlar, Misafir Hizmetleri…).
- AD2. Tıbbi bölümler görseldeki tam listeye göre çoğalt (100+). Bölüm tipi (İdari / Klinik / Yoğun Bakım / Lab / Radyoloji). Kod + çeviri.

## Faz AE — Pending (önceki)
- Madde 4: Bölüm Randevu Tipi (randevu↔bölüm↔protokol↔hizmet).
- Madde 7: rol bazlı rapor yetkisi + kalan raporların içi + gerçek filtre.
- Madde 6: zengin hizmet kartı (yeni hizmet tanımı tek karttan).
- Madde 1: çeviri eksikleri taraması; diğer liste ekranlarında tıkla-aç + filtre (genel desen).

## Önerilerim (sahibin "sen de ekle" dediği)
- Excel'e aktar düğmesini rapor dışında: hasta listeleri, bölüm/hizmet/personel listeleri, vezne faturalar, iş takip.
- Her liste ekranında tek desen: ara/filtre + satıra tıkla-aç + (yetkiyle) ekle/düzenle/sil + Excel.
- Denetim kaydı (audit) kritik işlemlerde (zaten var) — yetki/kullanıcı değişikliklerini de kapsasın.
