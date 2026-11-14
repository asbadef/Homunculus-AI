#!/usr/bin/env bash
# Güncelleme öncesi ön kontrol (değişiklik yapmaz).
set -uo pipefail
cd /opt/homunculus
echo "HEAD: $(git rev-parse --short HEAD)"
echo "izlenen degisiklik: $(git status --porcelain | grep -vc '^??')"
git status --porcelain | grep -v '^??' | head
git fetch -q origin main && echo "origin/main: $(git rev-parse --short origin/main)"
git merge-base --is-ancestor HEAD origin/main && echo "ileri sarilabilir: evet" || echo "ileri sarilabilir: HAYIR"
echo "READINGS_UNKNOWN_KEY satiri: $(grep -c '^READINGS_UNKNOWN_KEY' deploy/local/.env)"
df -h /opt | tail -1
docker ps --format '{{.Names}} {{.Status}}'
