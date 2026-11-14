#!/usr/bin/env bash
# VM'de (172.100.101.72) güncelleme öncesi yedek: veritabanının tam dökümü, api/web imajları, git HEAD.
# Kullanım: sudo bash yedek-al.sh        Son satır: zaman damgası (geri-don.sh bununla çağrılır).
set -euo pipefail
TS="$(date +%Y%m%d-%H%M%S)"
DIR=/opt/homunculus/yedek
mkdir -p "$DIR"
U="$(docker exec homunculus-postgres printenv POSTGRES_USER)"
D="$(docker exec homunculus-postgres printenv POSTGRES_DB)"
docker exec homunculus-postgres pg_dump -U "$U" -d "$D" --clean --if-exists | gzip > "$DIR/db-$TS.sql.gz"
gunzip -t "$DIR/db-$TS.sql.gz"
for img in local-api local-web; do docker tag "$img:latest" "$img:yedek-$TS"; done
git -C /opt/homunculus rev-parse HEAD > "$DIR/head-$TS.txt"
cp /opt/homunculus/deploy/local/.env "$DIR/env-$TS"
chmod 600 "$DIR/db-$TS.sql.gz" "$DIR/env-$TS"
echo "yedek: $DIR/db-$TS.sql.gz ($(du -h "$DIR/db-$TS.sql.gz" | cut -f1)) · head $(cut -c1-9 "$DIR/head-$TS.txt")" >&2
echo "$TS"
