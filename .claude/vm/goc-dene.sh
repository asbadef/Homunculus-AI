#!/usr/bin/env bash
# Göçleri canlıdan AYRI geçici bir PostgreSQL'de baştan sona uygular (upgrade head, sonra bir adım geri ve yeniden ileri).
# Kullanım: sudo bash goc-dene.sh <motor.tgz>
set -euo pipefail
TGZ="$1"
NET=hmc-goc-net; PG=hmc-goc-pg; DIR=/tmp/hmc-goc-eng
cleanup() { docker rm -f "$PG" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
cleanup
mkdir -p "$DIR" && tar -xzf "$TGZ" -C "$DIR" && chmod -R a+rwX "$DIR"
docker network create "$NET" >/dev/null
docker run -d --name "$PG" --network "$NET" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=hmcgoc postgres:16 >/dev/null
for _ in $(seq 1 30); do docker exec "$PG" pg_isready -U postgres -d hmcgoc >/dev/null 2>&1 && break; sleep 1; done
URL="postgresql+asyncpg://postgres:test@$PG/hmcgoc"
docker run --rm --network "$NET" -v "$DIR:/w" -w /w --entrypoint sh \
  -e DATABASE_URL="$URL" -e PYTHONPATH=/w/src local-api -c \
  "alembic upgrade head && alembic current && alembic downgrade -1 && alembic upgrade head && alembic current"
docker exec "$PG" psql -U postgres -d hmcgoc -c "\d units" | grep -E 'floor|care_tier|score_rule|code|age_group|ck_units'
docker exec "$PG" psql -U postgres -d hmcgoc -tc "select string_agg(enumlabel, ',') from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='unittype'"
