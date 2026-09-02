# Dräger Infinity entegrasyonu — biomed'e sorulacak sorular

**Tarih:** 2026-09-03
**Bağlam:** 2026-09-02 saha taramasında ICU'da 13 yataklı bir Dräger Infinity Kappa ağı
(VF9.1-C, `10.10.203.0/24`) canlı EKG üretirken bulundu — bu, Homunculus motorunun asıl
hedeflediği sürekli telemetri kaynağı. Bu nesil Dräger'in HL7 çıkışı ayrı bir yazılım olan
**Infinity Gateway** gerektiriyor; hastanenin bunu edinip edinemeyeceği bilinmiyor. Tam tasarım:
`docs/superpowers/specs/2026-09-03-drager-infinity-integration-design.md`.

## Sorular

1. **Infinity Gateway yazılımı hastanede kurulu mu?** Değilse, Dräger'den lisanslanabilir mi —
   kabaca maliyet, süre, bir servis ziyareti gerekir mi?

2. **`Win-DRGMON` entegrasyon sunucusu** (`10.10.207.2`) zaten başka sistemlere HL7 konuşuyor
   (Karl Storz SCENARA.connect, Medset PADSY, Nihon Kohden) ama üzerinde Dräger yazılımı yok —
   host adı Dräger'e göre ayrılmış görünüyor. Gateway oraya mı kurulacak, yoksa başka bir yere mi?

3. **Central station'daki (`ICU2`, etiket `BONADEA`) Biomed menüsünü kim yapılandırabilir** —
   HL7 ORU dışa aktarımını açıp bir hedef host:port girmek için? Hastane biomed ekibi mi, saha
   teknisyeni mi, yoksa yalnızca Dräger uzaktan destek mi?

4. **Gateway'in HL7 ORU çıkışı rastgele bir hedefe yönlendirilebilir mi** (bizim tarafımız:
   `172.100.101.72:2575` — ağ yolu 2026-09-02'de doğrulandı), yoksa Dräger tarafında özel bir
   alıcı sistem profili / kayıt mı gerekiyor?

5. **MS28819 Rev12 kılavuzu ("Infinity RS-232 Export Protocol") ve X5 kablosu (5206441)
   temin edilebilir mi?** Bu, Gateway olmadan bir yedek yol için gerekiyor — Kappa'nın kendi
   seri çıkışı, ventilatörler için zaten kurulmuş olan MEDIBUS köprüsünden tamamen farklı bir
   protokol.

6. **Hangi Kappa yataklarında X5 çıkışı fiziksel olarak erişilebilir / Biomed menüsünden aktif?**

## Not

Bu sorulara verilecek cevaplar, `docs/EDGE-BRIDGE-LOCAL.md`'deki "Dräger Infinity route" bölümünde
anlatılan keşif adımlarını doğrudan tetikler — Gateway varsa mevcut köprü hiç değişmeden
çalıştırılır, yoksa MS28819 gelene kadar bu iş beklemede kalır.
