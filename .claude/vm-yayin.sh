#!/usr/bin/env bash
# VM'e (172.100.101.72) arayüz yayını: verilen yamayı /opt/homunculus'a uygular, yalnız web'i derler,
# kaynağı geri alır (Asaf'ın klasörü temiz kalır), web'i yeniden başlatır.
# Kullanım (VM'de): sudo bash vm-yayin.sh /tmp/yama.patch etiket [/tmp/metinler.tar]
#
# Yama asbadef/main'e göre üretilir; VM'deki sürüm ondan eskidir. Bağlamı uymayan dosyalar yamadan
# çıkarılır:
#  - Shell.jsx: küçük düzeltme sed ile (EK_DUZELTME)
#  - i18n/strings/*.js: yalnız çeviri verisi; dosyanın TAMAMI üçüncü argümandaki tar'dan yazılır
set -euo pipefail
PATCH="$1"; TAG="${2:-yama}"; METIN="${3:-}"
EXCLUDE=(dashboard/src/live/shell/Shell.jsx)
METIN_DOSYALAR=()
if [ -n "$METIN" ]; then
  mapfile -t METIN_DOSYALAR < <(tar -tf "$METIN" | grep -v '/$')
  EXCLUDE+=("${METIN_DOSYALAR[@]}")
fi
cd /opt/homunculus
ARGS=(); for f in "${EXCLUDE[@]}"; do ARGS+=(--exclude="$f"); done
git apply --check "${ARGS[@]}" "$PATCH"
docker tag local-web:latest "local-web:yedek-$(date +%Y%m%d-%H%M)"
temizle() {
  cd /opt/homunculus
  git apply -R "${ARGS[@]}" "$PATCH" || true
  git checkout -- "${EXCLUDE[@]}" 2>/dev/null || true
  for f in "${METIN_DOSYALAR[@]}"; do git ls-files --error-unmatch "$f" >/dev/null 2>&1 || rm -f "$f"; done
}
trap temizle EXIT
git apply "${ARGS[@]}" "$PATCH"
[ -n "$METIN" ] && tar -xf "$METIN" -C /opt/homunculus
# EK_DUZELTME — Shell.jsx: sol menü 86 px -> 96 px (prototipin .shell ızgarası)
grep -q 'grid-cols-\[86px_minmax' dashboard/src/live/shell/Shell.jsx
sed -i 's/grid-cols-\[86px_minmax(0,1fr)\]/grid-cols-[96px_minmax(0,1fr)]/' dashboard/src/live/shell/Shell.jsx
cd deploy/local
BUILD_SHA="$(git rev-parse --short HEAD)+$TAG" docker compose build web 2>&1 | tail -2
docker compose up -d --no-deps web 2>&1 | tail -1
