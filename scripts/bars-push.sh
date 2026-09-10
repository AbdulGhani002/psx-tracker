#!/usr/bin/env bash
# Fetch today's bars on this machine and put them in the server's cache.
#
#   bash scripts/bars-push.sh
#
# Runs from Task Scheduler ("PSX bars push") on weekdays after the close, so
# the 14:45 CEST report finds fresh series without the server touching the
# PSX portal. Log: bars-push.log in the project root.
set -euo pipefail
cd "$(dirname "$0")/.."
TMPDIR_W=$(cygpath -m "${TEMP:-/tmp}" 2>/dev/null || echo "${TEMP:-/tmp}")
OUT="$TMPDIR_W/psx-bars-bundle.json"
ARCHIVE="${ARCHIVE:-C:/CC/Data/psx-history}"

echo "=== $(date -u +%Y-%m-%dT%H:%MZ) archive (missing days only)"
npx tsx scripts/psx-history.ts --out "$ARCHIVE" --from 2002-01-01 --concurrency 2 | tail -2

echo "=== fetching"
npx tsx scripts/bars-push.ts --archive "$ARCHIVE" --out "$OUT" "$@"

echo "=== uploading"
ssh -o BatchMode=yes apex-vps 'cat > /root/bars-bundle.json' < "$OUT"
local_sum=$(sha256sum "$OUT" | cut -d" " -f1)
remote_sum=$(ssh -o BatchMode=yes apex-vps 'sha256sum /root/bars-bundle.json' | cut -d" " -f1)
[ "$local_sum" = "$remote_sum" ] || { echo "digest mismatch after upload"; exit 1; }
ssh -o BatchMode=yes apex-vps 'set -a; . /root/psx-tracker-v2/.env.local; set +a; node /root/psx-tracker-v2/jobs/quant-import.js /root/bars-bundle.json --bars && rm -f /root/bars-bundle.json'
echo "=== done"
