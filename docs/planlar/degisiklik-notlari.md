# Değişiklik notları (Asaf için)

Prototipi canlıya taşıma çalışmasının tur tur özeti. Ayrıntı: `docs/superpowers/specs/2026-11-14-prototip-tam-tasima-design.md`.

## Tur 0 — Sunucu güncelleme altyapısı (2026-11-14)

- **VM güncellendi:** `/opt/homunculus` `331df70` → `fa748b6` (asbadef/main, ileri sarma). `api` ve `web` yeniden derlendi; `bridge` ve `postgres` yeniden başlatılmadı.
- **Göçler:** 0020 (kalite görünümü), 0022 (iş yükü), 0021 (cihaz ölçüm kaydı) uygulandı; `alembic current` = 0021 (head).
- **Yedek:** güncelleme öncesi `/opt/homunculus/yedek/db-20261114-055355.sql.gz` (+ `local-api/local-web:yedek-20261114-055355`, `head-…`, `env-…`). Geri dönüş: `sudo bash geri-don.sh 20261114-055355`.
- **`.env`:** `READINGS_UNKNOWN_KEY=card` eklendi. Neden: güncelleme sırasında panoda görünen hiçbir şey değişmesin; tanınmayan numaralı monitör okumaları bugünkü gibi isimsiz kart açıyor. «Eşleşmeyen ölçümler» listesine geçiş sahiple ayrıca kararlaştırılacak (senin varsayılanın hastane için o; satır silinip `docker compose up -d api` yeterli).
- **Yayın yöntemi değişti:** artık yama yok. `.claude/vm-yayin.ps1` → VM'de `yedek-al.sh` (her seferinde tam yedek) + `guncelle.sh` (origin/main'e ileri sarma, değişen servisi derleme). Betikler: `.claude/vm/`.
- **Doğrulama:** 16 ekran sahibin oturumuyla açıldı, sayfa hatası 0; monitör kutuları ve veri akışı etiketi yerinde. `/isyuku` sahibin hesabında «Bu sayfa yok» — `workload.view` yalnız `charge_nurse` grubunda (beklenen).


## Yataklar — liste, monitör, tanı (2026-11-14)

- **Liste görünümü** prototip düzeninde: birim birim tablo (Yatak, Hasta, Durum, HR, KB, SpO₂, RR, Isı, Skor, Uyarılar), altında boş yataklar. Eski listedeki alarm cümlesi, NEWS2 eskime bilgisi ve son ölçüm saati korundu.
- **Monitör değerleri satırda:** doğrulanmış değeri olmayan kanala monitörün değeri küçük «M» işaretiyle yazılıyor (`data-monitor-value`, `aria-hidden`); doğrulanmış değer her zaman önce. Risk, alarm, NEWS2 ve kartın bağlantı metni bu değerleri okumuyor (`monitorAlarmPath.test` bunları ayıklayıp aynılığı denetliyor).
- **Kart çizgisi:** motorda 2'den az nabız ölçümü varsa, pano açıkken monitörden gelen nabız noktaları çiziliyor (`data-monitor-trail`, yalnız tarayıcıda, hiçbir yere gönderilmiyor).
- **Karar 14'e bilinçli istisna (sahip isteği):** Ayrıntılar'daki monitör kutusu artık `variant="screen"` — prototipin `.mon`'u gibi koyu panel, kanal renkleri (HR yeşil, KB kırmızı, SpO₂ sarı, RR camgöbeği). DOĞRULANMAMIŞ etiketi, değer yaşları ve not aynen duruyor; panonun kendi vital renkleri (`text-v-*`) kullanılmadı. Uygun görmezsen `BedCard.jsx`'te tek kelime (`screen` → `compact`) ile eski haline döner.
- **Ayrıntılar** bir kartta açılınca bütün kartlarda açılıyor/kapanıyor.
- **Tanı:** kartta yaş/cinsiyetin yanına HIS'in gönderdiği tanılar (`diagnoses[].text`, yoksa kod) yazılıyor.
### Güncelleme — kartta Ayrıntılar kaldırıldı (sahip kararı, 2026-11-14)

- Yatak kartındaki **Ayrıntılar** bölümü tamamen kalktı (yukarıdaki «screen» monitör kutusu ve «hepsini aç» da onunla gitti). İçindekilerin hepsi hasta sayfasında zaten var: monitör kutusu (`variant="full"`), alarm cümleleri, `News2` uyarıları (eski/varsayılan girdi), gölge öneri kutusu. Kartta kalan: satırdaki M işaretli monitör değerleri ve «Monitör · canlı».
- Kartta kaybolmasın diye iki güvenlik işareti bayrağa taşındı: **«geçti · onaylanmadı»** (G2-A1) ve **NEWS2 kırmızı parametre** (`board.news2Red`).
- **Liste** prototipin `screens.js` `beds` satırından birebir: tüm satır tıklanır, sayılar sağa yaslı ve kanal renginde, skor tek satır, boş yatakta yalnız durum. Listedeki alarm cümlesi ve NEWS2 uyarıları da hasta sayfasında.
- Testler buna göre değişti (`BedCard.test`, `BedsScreen.test`, `monitorAlarmPath.test`, `rawKeys.test` — bu sonuncusunda bölüme bağlanmamış bir yatak eklendi ki monitör anahtarları yine ekranda denensin).
## Tur 1 — Hastane yapısı: birim türleri, kat, izlem düzeyi (2026-11-14)

- **Göç 0023** (`0023_unit_profile.py`, 0021'in ardından): `unittype` enum'una prototipin yoğun bakım dışı türleri eklendi (WARD, ER, CATH_LAB, CHEMO_DAY, DAY_CARE, IVF_DAY, NURSERY, CLINIC). `unit_type`'ı hiçbir motor kuralı okumuyor (yalnız `tenant/`), yani alarm/skor/öneri değişmez. Enum değeri geri alınamaz; downgrade yalnız kolonları siler.
- **`units` yeni kolonlar** (hepsi isteğe bağlı): `floor` (0 = zemin), `care_tier` (FULL «Tam izlem» · VITAL «Vital izlem» · OPERATIONAL «Operasyonel»), `score_rule` («SOFA + NEWS2», «PEWS»…), `code`, `age_group` (ADULT/CHILD/NEONATE). `care_tier` ve `score_rule` bugün yalnız **etiket**: motor kurallarını açıp kapatmaz.
- **API:** `POST /tenant/sites/{id}/units` ve `PATCH /tenant/units/{id}` bu alanları ve (PATCH) `unit_type`'ı alır; gönderilmeyen alan aynen kalır, null/boş metin temizler. Değişiklik `structure.update` olarak denetime düşer (eski/yeni değer). `GET /tenant/structure` birimde bu alanları döner.
- **Bina:** prototipin «Blok»u canlıdaki `site`. Birimi başka binaya taşıyan uç yok; bu turda bütün birimler mevcut binada kaldı.
- **Arayüz:** Yataklar birim başlığında prototipin etiketleri (tür · kat · izlem · skor kuralı); Yönetim › Yapı'da her birimin altında «Birim bilgileri» formu; birim türü adları prototipin kelimeleri (`H.KIND`/`KN`).
- **Testler:** motor `test_structure_api.py` (+3), arayüz StructureTab (+2). Motor testleri VM'de canlıdan ayrı geçici bir PostgreSQL'de koşuldu: `.claude/vm/test-calistir.sh`.