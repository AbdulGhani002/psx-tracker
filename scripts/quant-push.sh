#!/usr/bin/env bash
# Train the market model on this machine and push only the result to the
# server. The server never trains; it reads quant:model from the feed store.
#
#   bash scripts/quant-push.sh                 # refresh the archive, train on it, push
#   bash scripts/quant-push.sh --learner both  # any quant-train.ts flag passes through
#   ARCHIVE=/c/other/dir bash scripts/quant-push.sh
#
# The model is trained on the exchange's 24-year archive (scripts/psx-history.ts),
# which is first brought up to date: one request per trading day since the
# last pull. Runs weekly from Task Scheduler ("PSX quant train"); the log is
# quant-push.log in the project root.
set -euo pipefail
cd "$(dirname "$0")/.."
TMPDIR_W=$(cygpath -m "${TEMP:-/tmp}" 2>/dev/null || echo "${TEMP:-/tmp}")
OUT="$TMPDIR_W/psx-quant-model.json"
ARCHIVE="${ARCHIVE:-C:/CC/Data/psx-history}"

echo "=== $(date -u +%Y-%m-%dT%H:%MZ) archive"
npx tsx scripts/psx-history.ts --out "$ARCHIVE" --from 2002-01-01 --concurrency 3

echo "=== training on the archive"
NODE_OPTIONS=--max-old-space-size=6144 npx tsx scripts/quant-train.ts --dry --archive "$ARCHIVE" --seeds 1 --finalSeeds 3 --learner gbm --step 250 --minTrain 750 --out "$OUT" "$@"

echo "=== uploading"
ssh -o BatchMode=yes apex-vps 'cat > /root/quant-model.json' < "$OUT"
local_sum=$(sha256sum "$OUT" | cut -d" " -f1)
remote_sum=$(ssh -o BatchMode=yes apex-vps 'sha256sum /root/quant-model.json' | cut -d" " -f1)
[ "$local_sum" = "$remote_sum" ] || { echo "digest mismatch after upload"; exit 1; }
ssh -o BatchMode=yes apex-vps 'set -a; . /root/psx-tracker-v2/.env.local; set +a; node /root/psx-tracker-v2/jobs/quant-import.js /root/quant-model.json && rm -f /root/quant-model.json'
echo "=== done"
