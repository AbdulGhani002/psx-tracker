// Runs ON THE SERVER with the archive's corporate-action record
// (scripts/events-build.ts writes it): every cash dividend, bonus and split
// into the shareevents collection (lib/models/ShareEvent.ts), where the
// evening job adds each new one from the exchange's closing file. A day the
// evening job already recorded is left as it is.
//   NODE_PATH=/root/psx-tracker-v2/node_modules node events-import.cjs FILE
const fs = require("fs");
const mongoose = require("mongoose");

(async () => {
  const snap = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  if (!snap || typeof snap.symbols !== "object") throw new Error("not an events record");
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  const col = mongoose.connection.db.collection("shareevents");
  await col.createIndex({ symbol: 1, date: 1 }, { unique: true });
  const ops = [];
  for (const [symbol, rows] of Object.entries(snap.symbols)) {
    for (const [date, kind, cash, yieldPct, ratioPct] of rows) {
      ops.push({ updateOne: { filter: { symbol, date }, update: { $setOnInsert: { symbol, date, kind, cash, yieldPct: kind === "cash" ? yieldPct : 0, ratioPct, source: "archive" } }, upsert: true } });
    }
  }
  let added = 0;
  for (let i = 0; i < ops.length; i += 500) added += (await col.bulkWrite(ops.slice(i, i + 500), { ordered: false })).upsertedCount;
  console.log(`events: ${ops.length} in the record to ${snap.dataTo}, ${added} added`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
