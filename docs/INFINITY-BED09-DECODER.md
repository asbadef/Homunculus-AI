# BED09 kısmi araştırma decoder'ı — 22 Eylül 2026

Hedef .26 →224.0.2.26 UDP2050/source2564. Ubuntu worker→hub aktarımı
22 Eylül07:23UTC'de241→257→271 paket ile doğrulandı. Bu çalışma sayısal adayları
çözmek içindir; hasta eşleştirmesi, klinik ingest, alarm veya cihaz kontrolü içermez.

## Kanıt ve sınırlar

Özel13138cf075b148e48bf64d08065aa432 kaydı299 paket içerir:522×179,744×60,
1422×60. Önceki.28 profilinin biçimleri bunları reddetti. Eski guard'ların tam ve
tekil eşleşmesi her ilgili pakette şu aday konumlarını verdi:

| Aday | UDP uzunluğu | Sıfır tabanlı değer konumu | İşaret uzunluğu | Kanıt |
|---|---:|---:|---:|---|
| SpO₂ | 744 | 528 | 6 bayt | 60/60 pakette tekil tam eşleşme |
| PLS | 1422 | 1350 | 16 bayt | 60/60 pakette tekil tam eşleşme |
| HR | — | — | — | Eski işaret eşleşmedi; eşleme yok |
| RESP | — | — | — | Eski işaret eşleşmedi; eşleme yok |

Alanlar big-endian uint16 **ham adaylar** olarak okunur. Bunlar üretici parametre
kimlikleri doğrulanmış eşlemeler değildir; kontrol baytlarının benzerliği tek başına
semantiği kanıtlamaz. Birim, ölçek, geçerlilik, sentinel ve cihaz zamanı henüz belirsiz.
PLS, HR yerine yazılmaz. Klinik kayda aktarılmaz. Guard zayıflatılarak HR/RESP uydurulmadı.
522 baytlık paketlerde çözümleme denenmez; bu paketlerin dalga biçimi olduğu iddia
edilmez ve bunlar aday sayıların tazeliğini yenilemez.

## Değişiklik

Decoder profile.v2 tam dört alan sözleşmesini korur. Yeni profile.v3, eşlenmeyen
alanları `unmapped_fields` ile açıkça listeler; eşlenen ve eşlenmeyen alanlar
çakışamaz ve toplamları mevcut dört adayın tamamını kapsamalıdır. Bilinmeyen alan
ismi, aynı alanın tekrar tanımlanması, yanlış kaynak/port/boy/guard reddedilir.

LiveResearchView/araştırma ekranı `mapping_status=unmapped` alanlarını boş ve
"Bu cihazda alanın yeri henüz eşlenmedi" olarak gösterir. Alan başına3sn tazelik,
gecikmiş kuyruk/tekrar/replay kontrolü ve klinikfalse bayrakları korunur.

Gerçek kayıtta120 decoded,179 ignored,0 rejected. Bu çalışma aynı kayıttan üretilen
profilin yine aynı kayıtta kontrolüdür; bağımsız doğrulama değildir. Ham paketler,
aday değerler ve guard içeriği repoya alınmadı. Özel profil capture SHA256 ile bu
kayıtla sınırlandırılmıştır; canlı kullanım açıkça unverified_layout olarak kalır.

## Dağıtım

Özel ZIP `%TEMP%/HomunculusDeploy/infinity-bed09-decoder-20260922.zip` içinde
izinli kaynak dosyaları, manifest, özel araştırma profili ve kurucu vardır.
PCAP/video/anahtar yoktur. ZIP'i repoya eklemeyin.

Hub.72'de mevcutvenv ile `install_bed09_decoder.py --apply` çalışır. Önceki
30-continuous ve40-bed09 override'ları doğrulanır. Yeni immutable decoder release,
50-bed09-decoder.conf ile etkinleştirilir. Sadece hub yeniden başlar; worker,
DB, anahtarlar ve ağ değişmez. Başarısız sağlık kontrolünde önceki50override
geri yüklenir (yoksa yalnız yeni50kaldırılır) ve önceki hub yeniden başlar.
Sağlık kontrolü profil/kaynak/API doğrular; canlı sayı doğrulaması ayrı adımdır.

Eski activation/switch yardımcıları yeni50override varken tekrar çalıştırılmamalı.
Productionweb Docker imajı bu adımda güncellenmez; yerel5175 araştırma ekranı
değişikliği içerir. Üretim uygulamasına araştırma ekranı entegrasyonu ayrı eksiktir.

## Sonraki bağımsız kontrol

Kullanıcı BED09 ekranına erişebildiğini bildirdi. Kurulumdan sonra taze adaylar,
aynı anda görülen SpO₂ vePLS ile kıyaslanmalı; HR/RESP için eşzamanlı ekran
referansı ve yeni paketler üzerinden alan araştırması sürdürülmeli. Eski kaydın
değerleri bugünkü monitör değerleriyle karşılaştırılmamalı.

Testler: decoder/live/transport/kurulum57; frontend/routing22. Kurulum geri dönüşü,
v2 uyumluluğu, kısmi eşlemeler, guard reddi ve sayının3sn sonra gizlenmesi kontrol edildi.
