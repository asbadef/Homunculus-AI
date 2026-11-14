# Değişiklik notları (Asaf için)

Prototipi canlıya taşıma çalışmasının tur tur özeti. Ayrıntı: `docs/superpowers/specs/2026-11-14-prototip-tam-tasima-design.md`.

## Tur 0 — Sunucu güncelleme altyapısı (2026-11-14)

- **VM güncellendi:** `/opt/homunculus` `331df70` → `fa748b6` (asbadef/main, ileri sarma). `api` ve `web` yeniden derlendi; `bridge` ve `postgres` yeniden başlatılmadı.
- **Göçler:** 0020 (kalite görünümü), 0022 (iş yükü), 0021 (cihaz ölçüm kaydı) uygulandı; `alembic current` = 0021 (head).
- **Yedek:** güncelleme öncesi `/opt/homunculus/yedek/db-20261114-055355.sql.gz` (+ `local-api/local-web:yedek-20261114-055355`, `head-…`, `env-…`). Geri dönüş: `sudo bash geri-don.sh 20261114-055355`.
- **`.env`:** `READINGS_UNKNOWN_KEY=card` eklendi. Neden: güncelleme sırasında panoda görünen hiçbir şey değişmesin; tanınmayan numaralı monitör okumaları bugünkü gibi isimsiz kart açıyor. «Eşleşmeyen ölçümler» listesine geçiş sahiple ayrıca kararlaştırılacak (senin varsayılanın hastane için o; satır silinip `docker compose up -d api` yeterli).
- **Yayın yöntemi değişti:** artık yama yok. `.claude/vm-yayin.ps1` → VM'de `yedek-al.sh` (her seferinde tam yedek) + `guncelle.sh` (origin/main'e ileri sarma, değişen servisi derleme). Betikler: `.claude/vm/`.
- **Doğrulama:** 16 ekran sahibin oturumuyla açıldı, sayfa hatası 0; monitör kutuları ve veri akışı etiketi yerinde. `/isyuku` sahibin hesabında «Bu sayfa yok» — `workload.view` yalnız `charge_nurse` grubunda (beklenen).
