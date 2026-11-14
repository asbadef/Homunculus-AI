#!/usr/bin/env bash
# VM'i origin/main'e ileri sarar ve değişen servisleri (api / web) derleyip yeniden başlatır.
# Köprü ve postgres'e dokunmaz. Önce yedek-al.sh çalışmış olmalı.
# Kullanım: sudo bash guncelle.sh [--kuru] [--hepsi]
#   --kuru  : ne derleneceğini yazar, hiçbir şey değiştirmez
#   --hepsi : değişiklik ne olursa olsun api ve web derlenir
set -euo pipefail
KURU=0; HEPSI=0
for a in "$@"; do case "$a" in --kuru) KURU=1;; --hepsi) HEPSI=1;; esac; done
cd /opt/homunculus
[ "$(git status --porcelain | grep -vc '^??')" = "0" ] || { echo "izlenen dosyada elle degisiklik var, duruyorum" >&2; exit 1; }
git fetch -q origin main
ESKI="$(git rev-parse HEAD)"; YENI="$(git rev-parse origin/main)"
git merge-base --is-ancestor "$ESKI" "$YENI" || { echo "ileri sarilamiyor" >&2; exit 1; }
DEG="$(git diff --name-only "$ESKI" "$YENI")"
SERV=()
{ [ $HEPSI = 1 ] || echo "$DEG" | grep -q '^homunculus-engine/\|^deploy/local/'; } && SERV+=(api)
{ [ $HEPSI = 1 ] || echo "$DEG" | grep -q '^dashboard/\|^deploy/local/web/'; } && SERV+=(web)
echo "$(git rev-parse --short "$ESKI") -> $(git rev-parse --short "$YENI") · servisler: ${SERV[*]:-yok}"
[ $KURU = 1 ] && exit 0
# Tur 0 kararı: tanınmayan numaralı monitör okuması bugünkü gibi kart açar (yeni davranış ayrı karar).
grep -q '^READINGS_UNKNOWN_KEY=' deploy/local/.env || echo 'READINGS_UNKNOWN_KEY=card' >> deploy/local/.env
git merge -q --ff-only "$YENI"
[ ${#SERV[@]} = 0 ] && exit 0
cd deploy/local
BUILD_SHA="$(git rev-parse --short HEAD)" docker compose build "${SERV[@]}" 2>&1 | grep -E 'Built|ERROR|error' || true
docker compose up -d --no-deps "${SERV[@]}" 2>&1 | tail -2
if printf '%s\n' "${SERV[@]}" | grep -q api; then
  for i in $(seq 1 60); do
    s="$(docker inspect -f '{{.State.Health.Status}}' homunculus-api 2>/dev/null || echo yok)"
    [ "$s" = healthy ] && break
    sleep 3
  done
  echo "api: $s"
  docker logs --since 10m homunculus-api 2>&1 | grep -E 'Running upgrade|ERROR|Traceback' | tail -8 || true
fi
docker ps --format '{{.Names}} {{.Status}}'
