#!/usr/bin/env bash
# VM'e (172.100.101.72) arayüz yayını: verilen yamayı /opt/homunculus'a uygular, yalnız web'i derler,
# kaynağı geri alır (Asaf'ın klasörü temiz kalır), web'i yeniden başlatır.
# Kullanım (VM'de): sudo bash vm-yayin.sh /tmp/yama.patch etiket
#
# Yama asbadef/main'e göre üretilir; VM'deki sürüm ondan eskidir. Bağlamı uymayan dosyalar yamadan
# çıkarılır (--exclude) ve buradaki küçük düzeltmelerle uygulanır (EK_DUZELTME).
set -euo pipefail
PATCH="$1"; TAG="${2:-yama}"
EXCLUDE=(dashboard/src/live/shell/Shell.jsx)
cd /opt/homunculus
ARGS=(); for f in "${EXCLUDE[@]}"; do ARGS+=(--exclude="$f"); done
git apply --check "${ARGS[@]}" "$PATCH"
docker tag local-web:latest "local-web:yedek-$(date +%Y%m%d-%H%M)"
temizle() {
  cd /opt/homunculus
  git apply -R "${ARGS[@]}" "$PATCH" || true
  git checkout -- "${EXCLUDE[@]}" || true
}
trap temizle EXIT
git apply "${ARGS[@]}" "$PATCH"
# EK_DUZELTME — Shell.jsx: sol menü 86 px -> 96 px (prototipin .shell ızgarası)
grep -q 'grid-cols-\[86px_minmax' dashboard/src/live/shell/Shell.jsx
sed -i 's/grid-cols-\[86px_minmax(0,1fr)\]/grid-cols-[96px_minmax(0,1fr)]/' dashboard/src/live/shell/Shell.jsx
cd deploy/local
BUILD_SHA="$(git rev-parse --short HEAD)+$TAG" docker compose build web 2>&1 | tail -2
docker compose up -d --no-deps web 2>&1 | tail -1
