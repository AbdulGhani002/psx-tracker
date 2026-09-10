#!/usr/bin/env bash
# Train the market model on this machine and push only the result to the
# server. The server never trains; it reads quant:model from the feed store.
#
#   bash scripts/quant-push.sh                # three seeds, boosted trees, market context
#   bash scripts/quant-push.sh --learner both # any quant-train.ts flag passes through
#
# Runs weekly from Task Scheduler ("PSX quant train"); the log is quant-push.log
# in the project root.
set -euo pipefail
cd "$(dirname "$0")/.."
TMPDIR_W=$(cygpath -m "${TEMP:-/tmp}" 2>/dev/null || echo "${TEMP:-/tmp}")
OUT="$TMPDIR_W/psx-quant-model.json"
CACHE="${QUANT_CACHE:-$TMPDIR_W/psx-quant-cache}"

echo "=== $(date -u +%Y-%m-%dT%H:%MZ) training"
npx tsx scripts/quant-train.ts --dry --seeds 3 --learner gbm --cache "$CACHE" --out "$OUT" "$@"

echo "=== uploading"
ssh -o BatchMode=yes apex-vps 'cat > /root/quant-model.json' < "$OUT"
local_sum=$(sha256sum "$OUT" | cut -d" " -f1)
remote_sum=$(ssh -o BatchMode=yes apex-vps 'sha256sum /root/quant-model.json' | cut -d" " -f1)
[ "$local_sum" = "$remote_sum" ] || { echo "digest mismatch after upload"; exit 1; }
ssh -o BatchMode=yes apex-vps 'set -a; . /root/psx-tracker-v2/.env.local; set +a; node /root/psx-tracker-v2/jobs/quant-import.js /root/quant-model.json && rm -f /root/quant-model.json'
echo "=== done"
