#!/usr/bin/env bash
# Hand the server what the exchange no longer serves it (since 9 Oct 2026 the
# site closes every data request from the server's address; this machine is
# served as before): the closing files, the index pages and a few company
# pages, fetched here slowly by scripts/dps-push.ts, then the evening chain on
# the server (/api/cron/dps-relay).
#
#   bash scripts/dps-push.sh [--now]
#
# Task Scheduler runs it Monday to Saturday after the close ("PSX DPS relay"),
# starting at a random minute in the next quarter-hour unless --now. Log:
# dps-push.log in the project root.
set -euo pipefail
cd "$(dirname "$0")/.."
[ "${1:-}" = "--now" ] || sleep $((RANDOM % 900))
TMPDIR_W=$(cygpath -m "${TEMP:-/tmp}" 2>/dev/null || echo "${TEMP:-/tmp}")
OUT="$TMPDIR_W/psx-dps-bundle.json"
PLAN="$TMPDIR_W/psx-dps-plan.json"

echo "=== $(date '+%Y-%m-%d %H:%M') what the server wants"
ssh -o BatchMode=yes -o ConnectTimeout=20 apex-vps 'set -a; . /root/psx-tracker-v2/.env.local; set +a; curl -s -m 120 -u "$AUTH_USERNAME:$AUTH_PASSWORD" -X POST -H "content-type: application/json" -d "{\"plan\":true}" http://127.0.0.1:8012/api/cron/dps-relay' > "$PLAN"
head -c 400 "$PLAN"; echo

echo "=== fetching here"
npx tsx scripts/dps-push.ts --plan-file "$PLAN" --out "$OUT" --archive C:/CC/Data/psx-history

echo "=== handing over"
gzip -c "$OUT" | ssh -o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=30 apex-vps 'gunzip > /root/dps-bundle.json && set -a && . /root/psx-tracker-v2/.env.local && set +a && curl -s -m 900 -u "$AUTH_USERNAME:$AUTH_PASSWORD" -X POST -H "content-type: application/json" --data-binary @/root/dps-bundle.json http://127.0.0.1:8012/api/cron/dps-relay; rm -f /root/dps-bundle.json'
rm -f "$OUT" "$PLAN"
echo
echo "=== done"
