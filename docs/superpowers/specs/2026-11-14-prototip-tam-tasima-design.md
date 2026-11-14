# Prototipin tamamını canlıya taşıma — tasarım

**Tarih:** 2026-11-14 · **Sahip:** Ozan · **Yürüten:** Claude · **İnceleyen:** Asaf (GitHub `asbadef/Homunculus-AI` main)

## Amaç

`localhost:5180` HBYS prototipinde ne varsa (ekran, buton, alan, tanım, iş akışı) canlıya (`172.100.101.72:8080`) taşınır. Canlıda karşılığı olmayan her şeyin **sunucu tarafı da yazılır** (veritabanı tablosu, API, testler). Yaklaşım "canlıdaki yapıya uydur" değil, "prototipteki işleyişi kur"dur.

## Değişmeyenler (güvenlik çizgisi)

- Hasta verisi gerçek kayıttan gelir; prototipin uydurma hasta kayıtları, sabit sayıları ve rastgele grafikleri canlıya konmaz. Aynı kutu/grafik gerçek veriyle dolar.
- Tanım ve katalog içerikleri (hizmet listesi, ilaç listesi, uyarı türleri, şablonlar, yasal metinler) gerçek içerik sayılır ve prototipten alınır.
- Canlıda var olan bilgi gizlenmez (ör. hasta başı monitör değerleri).
- Asaf'ın klinik güvenlik kuralları (doğrulanmamış monitör değerinin alarm üretmemesi, kritik alarm açıkken devir imzalanamaması, "bilinmiyor" ile "yok"un ayrılması) korunur; çelişki çıkarsa sahibe sorulur.

## Dağıtım (karar A, 2026-11-14)

- Sunucu programı (API) ve veritabanını Claude günceller; Asaf'a önceden haber verilir.
- Her sunucu yüklemesinden önce veritabanının **tam yedeği** alınır (`pg_dump`, VM'de `/opt/homunculus/yedek/`), web imajının yedeği zaten alınıyor.
- İlk sunucu yüklemesi Asaf'ın main'de bekleyen 3 göçünü (0020 kalite görünümü, 0021 vital ölçüm kayıtları, 0022 iş yükü) de canlıya çıkarır.
- Her değişiklik `asbadef/main`'e Türkçe kayıt mesajıyla gider; Asaf her şeyi GitHub'da görür. Her turun sonunda `docs/planlar/degisiklik-notlari.md`'ye Asaf için kısa not düşülür.

## Çalışma turu (her modülde aynı)

1. **Fark listesi** — prototipin her öğesi ile canlı yan yana; hiçbir öğe sessizce atlanmaz.
2. **Sunucu** — gerekiyorsa göç + API + testler (Python, mevcut `homunculus-engine` kalıplarıyla).
3. **Ekran** — prototipin ölçüleri tarayıcıdan okunup birebir uygulanır; testler.
4. **Yayın** — DB yedeği → API (varsa) → web; canlıda sahibin hesabıyla açılıp görüntü alınır.
5. **Teslim** — sahibe: prototip/canlı görüntüsü yan yana + "şunları dene" kontrol listesi.
6. **Sahip testi** — geri bildirim → düzeltme → sonraki tura geçiş.

## Sıra

| Tur | İş | Sunucu | Sahibin göreceği |
|---|---|---|---|
| 0 | Sunucu güncelleme altyapısı: yedek betiği, Asaf'ın bekleyen 3 göçünün canlıya alınması | evet | Hiçbir şey bozulmamış olmalı (kontrol listesi) |
| 1 | Hastane yapısı: bina ve kat; birim türleri (Acil, Poliklinik, Servis, Anjiyo, Kemoterapi, Günübirlik, IVF, Bebek odası…); Yönetim › Hastane yapısı ağacı; prototipin 15 birimi / 94 yatağı | evet | Yönetim'de ağaç; Yataklar ve Doluluk'ta tüm birimler |
| 2 | Hasta Uyarıları: 25 uyarı türü, ekleme/kaldırma/tarihçe, kartta etiketler, hasta başlığında şerit, Uyarı rehberi | evet | Yatak kartlarında "Alerji · Düşme yüksek…" etiketleri |
| 3 | Benim hastalarım: bakım ekibi panoya; Alarmlar ve Yataklar süzgeci | evet | "Benim hastalarım" süzgeci |
| 4 | Gelen yatışlar: hastane kayıt sisteminden (HL7 ADT) gelen ön kabul listesi + "Yatak ata"; Ayaktan, Eşleşme bekleyenler sekmeleri | evet | Hasta Kabul'de "Gelen yatışlar" |
| 5+ | Kalan hazır modüller (Yatak başı ölçüm, Eczane, RRT, Yönetici özeti, Kalite, İş yükü, Cihazlar, Denetim, Yönetim, Ayarlar, Hasta sayfası), sonra prototipte olup canlıda hiç olmayanlar (Vezne, Randevu, Laboratuvar, Ameliyathane, Hakediş…) | modüle göre | Her modül ayrı tur |

## Sahipten gerekenler

- Asaf'a sunucu tarafının da güncelleneceğinin haberi (bir kez).
- Oturum kapandıkça doğrulayıcı kodu.
- Her tur sonunda kontrol listesine göre test ve geri bildirim.
