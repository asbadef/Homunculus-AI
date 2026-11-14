#!/usr/bin/env bash
# VM'in anlık durumu (değişiklik yapmaz): kod sürümü, konteynerler, veritabanı göç başı, api günlüğü.
set -uo pipefail
cd /opt/homunculus
echo "kod: $(git rev-parse --short HEAD)"
docker ps --format '{{.Names}} | {{.Status}} | {{.Image}}'
docker inspect -f 'api olusturma: {{.Created}}' homunculus-api
U="$(docker exec homunculus-postgres printenv POSTGRES_USER)"; D="$(docker exec homunculus-postgres printenv POSTGRES_DB)"
echo "goc basi: $(docker exec homunculus-postgres psql -At -U "$U" -d "$D" -c 'select version_num from alembic_version')"
echo "--- api gunlugu (son 15 dk):"
docker logs --since 15m homunculus-api 2>&1 | grep -E 'upgrade|ERROR|Traceback|Started|Application startup' | tail -10
