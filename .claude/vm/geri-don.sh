#!/usr/bin/env bash
# VM'de bir yedeğe geri dönüş: kod (git), imajlar (api/web) ve veritabanı.
# Kullanım: sudo bash geri-don.sh <zaman_damgası> [--kuru]     --kuru: yalnız ne yapacağını yazar.
set -euo pipefail
TS="$1"; KURU="${2:-}"
DIR=/opt/homunculus/yedek
for f in "$DIR/db-$TS.sql.gz" "$DIR/head-$TS.txt" "$DIR/env-$TS"; do [ -f "$f" ] || { echo "yok: $f" >&2; exit 1; }; done
HEAD="$(cat "$DIR/head-$TS.txt")"
U="$(docker exec homunculus-postgres printenv POSTGRES_USER)"
D="$(docker exec homunculus-postgres printenv POSTGRES_DB)"
yap() { if [ "$KURU" = "--kuru" ]; then echo "[kuru] $*"; else echo "+ $*"; eval "$@"; fi; }
yap "git -C /opt/homunculus checkout -q --detach $HEAD"
yap "cp $DIR/env-$TS /opt/homunculus/deploy/local/.env"
yap "docker tag local-api:yedek-$TS local-api:latest && docker tag local-web:yedek-$TS local-web:latest"
yap "cd /opt/homunculus/deploy/local && docker compose stop api"
yap "gunzip -c $DIR/db-$TS.sql.gz | docker exec -i homunculus-postgres psql -q -U $U -d $D"
yap "cd /opt/homunculus/deploy/local && docker compose up -d --no-deps --no-build api web"
