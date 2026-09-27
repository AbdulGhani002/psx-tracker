#!/usr/bin/env bash
# Extend the 24-year archive with the end-of-day files the server fetches
# every evening (the PSX portal serves them to the server, not to this
# machine). Each kept day becomes days/DATE.json in the archive, a holiday an
# empty day, a day the archive already has is left alone, and the per-symbol
# files are reassembled, ready for a retrain.
#
#   bash scripts/sheets-pull.sh [ARCHIVE_DIR] [FROM]
set -euo pipefail
cd "$(dirname "$0")/.."
DIR="${1:-C:/CC/Data/psx-history}"
FROM="${2:-2026-09-01}"
TMP="$(mktemp)"
ssh apex-vps "cd /root/psx-tracker-v2 && set -a && . ./.env.local && set +a && node - $FROM" < scripts/sheets-dump.cjs > "$TMP"
node -e '
const fs = require("fs");
const [file, dir] = process.argv.slice(1);
const days = JSON.parse(fs.readFileSync(file, "utf8"));
let wrote = 0, kept = 0;
for (const d of days) {
  const f = dir + "/days/" + d.date + ".json";
  if (fs.existsSync(f) && JSON.parse(fs.readFileSync(f, "utf8")).length > 0) { kept++; continue; }
  if (d.rows.length === 0 && !d.holiday) continue;
  fs.writeFileSync(f, JSON.stringify(d.rows));
  wrote++;
}
console.log(days.length + " kept days on the server from the date asked; " + wrote + " written, " + kept + " already in the archive.");
' "$TMP" "$DIR"
rm -f "$TMP"
npx tsx scripts/psx-history.ts --out "$DIR" --assemble-only
