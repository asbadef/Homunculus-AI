#!/usr/bin/env bash
# Veritabanı göçlerinin durumu: kodun bildiği baş ve veritabanının bulunduğu yer.
set -uo pipefail
docker exec homunculus-api sh -c 'cd /app && alembic heads 2>&1 | tail -3; echo "--- current:"; alembic current 2>&1 | tail -3; echo "--- dosyalar:"; ls alembic/versions | sort | tail -5'
