#!/usr/bin/env bash
# Refresh the KSE-100 state table in the last trained model and push it.
#   bash scripts/outlook-refresh.sh
set -euo pipefail
cd "$(dirname "$0")/.."
TMPDIR_W=$(cygpath -m "${TEMP:-/tmp}" 2>/dev/null || echo "${TEMP:-/tmp}")
OUT="$TMPDIR_W/psx-quant-model.json"
npx tsx scripts/outlook-refresh.ts --model "$OUT"
echo "=== uploading"
ssh -o BatchMode=yes apex-vps 'cat > /root/quant-model.json' < "$OUT"
local_sum=$(sha256sum "$OUT" | cut -d" " -f1)
remote_sum=$(ssh -o BatchMode=yes apex-vps 'sha256sum /root/quant-model.json' | cut -d" " -f1)
[ "$local_sum" = "$remote_sum" ] || { echo "digest mismatch after upload"; exit 1; }
ssh -o BatchMode=yes apex-vps 'set -a; . /root/psx-tracker-v2/.env.local; set +a; node /root/psx-tracker-v2/jobs/quant-import.js /root/quant-model.json && rm -f /root/quant-model.json'
echo "=== done"
