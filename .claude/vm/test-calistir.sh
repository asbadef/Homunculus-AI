#!/usr/bin/env bash
# Motor testlerini VM'de, CANLIDAN AYRI geçici bir PostgreSQL'e karşı çalıştırır.
# Kullanım: sudo bash test-calistir.sh <motor.tgz> [pytest argümanları...]
# Canlı postgres'e (homunculus-postgres) ve canlı ağa dokunmaz; çıkarken test konteynerini ve ağını siler.
set -euo pipefail
TGZ="$1"; shift
NET=hmc-test-net; PG=hmc-test-pg; DIR=/tmp/hmc-test-eng
cleanup() { docker rm -f "$PG" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
cleanup
mkdir -p "$DIR" && tar -xzf "$TGZ" -C "$DIR" && chmod -R a+rwX "$DIR"
docker network create "$NET" >/dev/null
docker run -d --name "$PG" --network "$NET" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=hmctest postgres:16 >/dev/null
for _ in $(seq 1 30); do docker exec "$PG" pg_isready -U postgres -d hmctest >/dev/null 2>&1 && break; sleep 1; done
docker run --rm --network "$NET" -v "$DIR:/w" -w /w --entrypoint sh \
  -e TEST_DATABASE_URL="postgresql+asyncpg://postgres:test@$PG/hmctest" -e PYTHONPATH=/w/src \
  local-api -c "pip install -q 'pytest>=8.0' 'pytest-asyncio>=0.23' >/dev/null 2>&1; python -m pytest -q -p no:cacheprovider $*"
