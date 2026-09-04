#!/usr/bin/env bash
# nce-doctor.sh — "a reading was taken but the panel did not change": which layer stopped?
#
# Run on the Homunculus host, from deploy/local (or anywhere: it finds the compose dir from the
# running container). Read-only. Prints counts, timestamps, file NAMES (device metadata: peer
# address + epoch) and log lines the bridge already emits — never file contents or values.
#
#   bash deploy/local/nce-doctor.sh
#   curl -s https://raw.githubusercontent.com/asbadef/Homunculus-AI/main/deploy/local/nce-doctor.sh | bash
#
# Layers, in data-flow order:
#   1 device -> NCE -> SavedCopies     (is a NEW file there at all?)
#   2 SavedCopies -> host CIFS mount   (does the host still see the share?)
#   3 host mount -> nce container      (does the container see the same files?)
#   4 bridge scan/parse                (dosya= counters, rejections, ledger)
#   5 buffer -> api                    (kuyruk depth, POST /ingest status)
#   6 api -> board                     (patient count on /patients)
set -u

hr() { printf '\n== %s\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

COMPOSE_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' homunculus-nce 2>/dev/null || true)"
[ -z "$COMPOSE_DIR" ] && COMPOSE_DIR="$(pwd)"
ENV_FILE="$COMPOSE_DIR/.env"
getenv() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' ; }
SHARE="$(getenv NCE_SHARE_PATH)"; SHARE="${SHARE:-/mnt/nce}"
TOKEN="$(getenv TENANT_TOKEN)"
WEB_PORT="$(getenv WEB_PORT)"; WEB_PORT="${WEB_PORT:-80}"

hr "saat (host, UTC) — dosya adlarındaki epoch ile karşılaştır"
date -u '+%Y-%m-%d %H:%M:%S UTC   epoch=%s'
echo "compose dir: $COMPOSE_DIR   share: $SHARE"

hr "1+2. paylaşım host'ta bağlı mı?"
if mount | grep -F " $SHARE " ; then :; else echo "!! $SHARE MOUNT DEĞİL — bind edilen boş klasör; reboot sonrası fstab satırı yoksa böyle olur"; fi
if [ -d "$SHARE" ]; then
  total=$(ls -1 "$SHARE" 2>/dev/null | wc -l)
  echo "toplam dosya: $total"
  echo "son 60 dk içinde yazılan: $(find "$SHARE" -maxdepth 1 -type f -mmin -60 2>/dev/null | wc -l)   (NCEToHost: $(find "$SHARE" -maxdepth 1 -type f -mmin -60 -name '*NCEToHost*' 2>/dev/null | wc -l))"
  echo "en yeni 3 dosya (mtime, boyut, ad):"
  ls -lt --time-style=+%Y-%m-%dT%H:%M:%S "$SHARE" 2>/dev/null | awk 'NR>1 && NR<=4 {print "   " $6, $5, $7}'
  newest=$(ls -t "$SHARE" 2>/dev/null | head -1)
  ep=$(printf '%s' "$newest" | grep -oE -- '-[0-9]{10}-' | tr -d - | head -1)
  [ -n "$ep" ] && echo "en yeni dosyanın ad-epoch'u: $ep = $(date -u -d @"$ep" '+%Y-%m-%d %H:%M:%S UTC' 2>/dev/null)"
else
  echo "!! $SHARE yok"
fi

hr "3. nce konteyneri"
docker inspect -f 'durum={{.State.Status}} restart={{.RestartCount}} başladı={{.State.StartedAt}}' homunculus-nce 2>/dev/null || echo "!! homunculus-nce konteyneri yok"
echo "konteyner içinden /nce: $(docker exec homunculus-nce sh -c 'ls -1 /nce 2>/dev/null | wc -l' 2>/dev/null) dosya; en yeni: $(docker exec homunculus-nce sh -c 'ls -t /nce 2>/dev/null | head -1' 2>/dev/null)"
echo "okunabilirlik (uid 10001): $(docker exec homunculus-nce sh -c 'f=$(ls -t /nce | head -1); [ -r "/nce/$f" ] && echo OK || echo "!! OKUNAMIYOR (mount -o uid=10001 eksik?)"' 2>/dev/null)"

hr "4. köprü log'u (son 30 dk: sayaçlar, ret, keşif)"
docker logs --since 30m homunculus-nce 2>&1 | grep -E "dosya=|rejected|Eşlenmemiş|unreadable|uplink|KEŞİF|ERROR|Traceback|could not read" | tail -12
echo "-- son rapor satırı:"; docker logs homunculus-nce 2>&1 | grep -E "dosya=" | tail -1

hr "4b. ledger + kuyruk (konteyner içi SQLite)"
docker exec homunculus-nce python - <<'PY' 2>&1
import sqlite3, datetime, os
def utc(e): return datetime.datetime.fromtimestamp(int(e), datetime.timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
try:
    l = sqlite3.connect('/data/nce.db.ledger')
    n, mx = l.execute('select count(*), max(mtime) from processed').fetchone()
    fs = l.execute("select value from meta where key='first_start'").fetchone()
    print(f"işlenmiş dosya: {n}   en yeni işlenen mtime: {utc(mx) if mx else '-'}   first_start: {utc(fs[0]) if fs else '-'}")
    for name, mtime in l.execute('select name, mtime from processed order by mtime desc limit 3'):
        print('   ', utc(mtime), name)
except Exception as e:
    print('ledger okunamadı:', e)
try:
    b = sqlite3.connect('/data/nce.db')
    print('kuyrukta bekleyen gözlem (outbox):', b.execute('select count(*) from outbox').fetchone()[0])
except Exception as e:
    print('buffer okunamadı:', e)
PY

hr "5. api: /ingest son 30 dk"
docker logs --since 30m homunculus-api 2>&1 | grep -E "POST /ingest" | awk '{print $NF, $(NF-1)}' | sort | uniq -c | tail -5
[ -z "$(docker logs --since 30m homunculus-api 2>&1 | grep -E 'POST /ingest')" ] && echo "(son 30 dk'da hiç /ingest yok)"
docker logs --since 30m homunculus-api 2>&1 | grep -E "ERROR|Traceback|401|400 " | tail -3

hr "5b. en yeni HL7 kopyalarında hasta kimliği var mı? (PID-3 biçimi: rakam->d, harf->a)"
# ^^^X^PI = cihazda hasta kimliği GİRİLMEDEN kaydedilmiş ölçüm: CX.1-3 boş, X = kurum, PI = tip.
# Köprü bunu "missing or empty PID-3" ile reddeder; çözüm cihazda kimlik girmektir, yazılım değil.
for f in $(ls -t "$SHARE" 2>/dev/null | grep NCEToHost | head -5); do
  tr '\r' '\n' < "$SHARE/$f" | tr -d '\013\034' | awk -F'|' -v f="$f" '/^PID/ {s=$4; gsub(/[0-9]/,"d",s); gsub(/[A-Za-z]/,"a",s); tag=(s ~ /^\^\^\^/) ? "  !! kimlik yok" : ""; print "   " substr(f,1,40) "...  PID-3=" s tag}'
done

hr "6. pano: /patients"
# nginx yalnızca WEB_LISTEN_ADDR'a bağlanır; 127.0.0.1 çoğu kurulumda reddeder.
ADDR="$(getenv WEB_LISTEN_ADDR)"; ADDR="${ADDR:-127.0.0.1}"
if [ -n "$TOKEN" ]; then
  code=$(curl -s -m 5 -o /tmp/nce-doctor-p.json -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "http://${ADDR}:${WEB_PORT}/patients")
  echo "GET http://${ADDR}:${WEB_PORT}/patients -> http $code"
  [ -s /tmp/nce-doctor-p.json ] && docker exec -i homunculus-api python -c 'import sys,json; d=json.load(sys.stdin)["patients"]; print("hasta sayısı:", len(d)); [print("  ", p["patient_id"], "risk=", p["risk"], "uyarı=", len(p["alerts"]), "dolu alan=", [k for k,v in p["latest"].items() if v is not None]) for p in d]' < /tmp/nce-doctor-p.json
  rm -f /tmp/nce-doctor-p.json
else
  echo "(.env'de TENANT_TOKEN bulunamadı, atlandı)"
fi
printf '\n== bitti — bu çıktıyı olduğu gibi yapıştır (hasta verisi içermez)\n'
