# Veri zinciri planı — Hasta ↔ Protokol ↔ İşlem ↔ Fatura · 2026-10-25

Sahibin kararı: tamamlamaya bu zincirle başlıyoruz. Değişiklikler tarayıcıda kalıcı (yapıldı). Varsayılan dil Azerice. Yetki için 927'lik katalog gerçek kaynak; ekranlar o katalogdaki ilgili yetkiyi kontrol eder.

## Neden
Şu an hasta, protokol, işlem (istem), fatura, GFK, evrak **ayrı listeler** ve birbirini tetiklemiyor. Fatura kesilince GFK/evrak değişmiyor; vezne faturası hastaya sadece isimle bağlanıyor (kırılgan). Senin en çok vurguladığın "tek hasta kartı, altında birçok protokol" ilişkisi görselde var ama arkada zayıf. Önce bunu sağlam kuruyoruz; her şey bunun üstüne oturacak.

## Hedef model (sade)
```
HASTA (tek kart)
  └─ PROTOKOL (çok sayıda; her geliş/işlem bir protokol)
        ├─ bölüm · doktor · geliş tipi · protokol tipi · açık/kapalı · tarih
        ├─ İŞLEMLER (istem: tetkik / hizmet / ilaç / muayene)
        └─ FATURA (işlemlerden oluşur)
              ├─ tahsilat (ödeme)
              └─ evrak (veznede → teslim → muhasebe)
```

## Veri yapısı
- `protokolKayit`: `{ no, hastaId, bolum, doktor, gelisTipi, tip, kapali, tarih, islemIds[], fatura:{durum, tutar, katilim, banko} }`
- İşlemler (`orders`): her işleme `protokolNo` eklenir → hangi protokole ait belli olur.
- Fatura/GFK/evrak: ayrı seed yerine **protokolden türetilir** (protokolün fatura durumu = GFK; evrak protokole bağlı).
- Hepsi kalıcı (localStorage, bugün açıldı). Hasta kimlikleri sabit üretildiği için bağlar yenilemede korunur.

## Zincir kuralları
1. Protokol açılır (hasta kabulde ya da hasta360'ta "yeni protokol").
2. Doktor/vezne işlem (istem) ekler → işlem o protokole bağlanır.
3. Vezne fatura keser → protokoldeki işlemler "Faturalandı", protokol fatura durumu güncellenir → **GFK ve evrak otomatik** bu durumu yansıtır.
4. Tahsilat yapılır → fatura "Ödendi".
5. Protokol kapanınca: yeni işlem eklenemez (yetkisiz); kapalıda ekleme/silme ayrı yetki ister (`kapali_protokol_ekle/sil`).

## Yetki bağı (927 katalog)
Zincirdeki her kritik aksiyon Güvenlik Tanımları'ndaki ilgili yetkiye bağlanır:
protokol aç/kapa/sil, işlem tarih/doktor düzenle, fatura kes/iptal, tahsilat değiştir, protokole aktar, kurum değişikliği, avans/iade. Basit rol matrisi bunların üstünde "kim hangi ekranı görür"ü belirlemeye devam eder.

## Adımlar (kırmadan, aşamalı)
1. **Protokol deposu + API** (`H.proto`: list/create/addIslem/fatura/kapat) + kalıcılık. ← buradan başlıyoruz
2. **Hasta360 protokol listesi gerçek** + "Yeni protokol aç" gerçekten protokol oluşturur.
3. **İstem → protokol bağı:** doktor/vezne istem eklerken aktif protokole bağlanır.
4. **İşlem havuzu → fatura → GFK/evrak zinciri:** fatura kesilince hepsi güncellenir.
5. **Vezne + Medikal Muhasebe** bu tek zincirden okur (ayrı seed'ler kalkar).
6. **Yetki bağı:** zincir aksiyonları 927 katalogdaki yetkilere bağlanır.

## Durum
- [x] Kalıcılık (localStorage, düz listeler) · varsayılan dil AZ
- [x] **Adım 1 — protokol deposu + API** (`H.proto`): `H.data.protokolKayit[pid]` kalıcı; hasta360 protokol listesi depodan okur; "+ Yeni protokol" gerçek protokol açar (otomatik no, kalıcı); protokol kilidine tıkla aç/kapat (yetkili: kapat=admission, yeniden aç=protokol_duzenle). Mevcut demo protokoller bir kez depoya taşınır. Hasta kimlikleri sabit olduğu için bağ yenilemede korunur.
- [x] **Adım 2 — İstem → protokol bağı:** her yeni istem (`addOrder`, vezne tetkik, kabul otomatik hizmet) hastanın aktif protokolüne bağlanır (ekranda seçili → yoksa açık/son). Karar: istem **seçili protokole** bağlanır, hastada **birden çok açık protokol** olabilir. İşlem Havuzu'nda protokol filtresi + Protokol sütunu; Tedavi tablolarında Protokol sütunu.
- [ ] Adım 3 — İşlem havuzu → fatura → GFK/evrak zinciri (fatura kesilince protokol+GFK+evrak otomatik güncellenir)
- [ ] Adım 4–6 — vezne+medikal muhasebe tek kaynaktan, 927 yetki bağı
