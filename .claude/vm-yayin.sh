#!/usr/bin/env bash
# VM'e (172.100.101.72) arayüz yayını: verilen yamayı /opt/homunculus'a uygular, yalnız web'i derler,
# yamayı geri alır (Asaf'ın kaynak klasörü temiz kalır), web'i yeniden başlatır.
# Kullanım (VM'de): sudo bash vm-yayin.sh /tmp/yama.patch etiket
set -euo pipefail
PATCH="$1"; TAG="${2:-yama}"
cd /opt/homunculus
git apply --check "$PATCH"
docker tag local-web:latest "local-web:yedek-$(date +%Y%m%d-%H%M)"
git apply "$PATCH"
trap 'cd /opt/homunculus && git apply -R "$PATCH" || true' EXIT
cd deploy/local
BUILD_SHA="$(git rev-parse --short HEAD)+$TAG" docker compose build web 2>&1 | tail -2
docker compose up -d --no-deps web 2>&1 | tail -1
echo "kaynak-degisiklik-sayisi(geri alindiktan sonra 0 olmali): bkz. trap"
