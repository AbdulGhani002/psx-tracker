#!/usr/bin/env bash
# The strategy model trained again on everything this machine's archive
# knows, and sent to the server only if its tested record is no worse than
# the one the server runs (scripts/model-gate.cjs).
#
#   bash scripts/monthly-retrain.sh [--now]
#
# Task Scheduler runs it every Sunday ("PSX monthly retrain"); it works only
# in the first week of the month unless --now. Log: retrain.log in the
# project root.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${1:-}" != "--now" ] && [ "$(date +%-d)" -gt 7 ]; then
  echo "$(date '+%Y-%m-%d'): not the first week of the month"
  exit 0
fi
ARCHIVE=C:/CC/Data/psx-history
MACRO=C:/CC/Data/macro
TMPDIR_W=$(cygpath -m "${TEMP:-/tmp}" 2>/dev/null || echo "${TEMP:-/tmp}")

echo "=== $(date '+%Y-%m-%d %H:%M') archive: the days the server keeps"
bash scripts/sheets-pull.sh "$ARCHIVE" "$(date -d '-45 days' +%Y-%m-%d)" | tail -2

echo "=== world series, CPI and company figures from the server"
ssh -o BatchMode=yes -o ConnectTimeout=20 apex-vps "cd /root/psx-tracker-v2 && set -a && . ./.env.local && set +a && node -" < scripts/macro-dump.cjs > "$TMPDIR_W/macro-dump-new.json"
node scripts/macro-dump-merge.cjs "$MACRO/macro-dump.json.gz" "$TMPDIR_W/macro-dump-new.json" "$MACRO/macro-dump.json.gz"
rm -f "$TMPDIR_W/macro-dump-new.json"

echo "=== training"
NODE_OPTIONS=--max-old-space-size=8000 npx tsx scripts/macro-final.ts --archive "$ARCHIVE" --macro "$MACRO" --out "$MACRO/macro-model-new.json" --seeds 5 | tail -5

echo "=== the gate"
if node scripts/model-gate.cjs "$MACRO/macro-model.json" "$MACRO/macro-model-new.json"; then
  ssh -o BatchMode=yes -o ConnectTimeout=20 apex-vps 'cat > /root/macro-model.json && cd /root/psx-tracker-v2 && set -a && . ./.env.local && set +a && node jobs/quant-import.js /root/macro-model.json macro:model && NODE_PATH=/root/psx-tracker-v2/node_modules node -e "const m=require(\"mongoose\");m.connect(process.env.MONGODB_URI).then(()=>m.connection.db.collection(\"feedsnapshots\").deleteOne({key:\"macro:live:v3\"})).then(r=>{console.log(\"reading worked out again on the next view\");return m.disconnect()})" && rm -f /root/macro-model.json' < "$MACRO/macro-model-new.json"
  mv "$MACRO/macro-model-new.json" "$MACRO/macro-model.json"
else
  rm -f "$MACRO/macro-model-new.json"
fi
echo "=== done"
