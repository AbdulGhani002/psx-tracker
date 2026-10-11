// Runs ON THE SERVER with the bundle scripts/seed-bars.ts wrote: one
// eod:bars:SYMBOL series for each share the server does not keep yet, in the
// shape lib/quant/store.ts reads. Series it keeps are left alone. Plain
// CommonJS with the standalone build's mongoose:
//   NODE_PATH=/root/psx-tracker-v2/node_modules node seed-import.cjs FILE
const fs = require("fs");
const mongoose = require("mongoose");

(async () => {
  const file = process.argv[2];
  const bundle = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!bundle || typeof bundle.series !== "object" || !bundle.fetchedAt) throw new Error("not a bars bundle");
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  const col = mongoose.connection.db.collection("feedsnapshots");
  const kept = new Set((await col.find({ key: /^eod:bars:/ }, { projection: { key: 1 } }).toArray()).map((d) => d.key));
  const fresh = Object.entries(bundle.series).filter(([s, bars]) => Array.isArray(bars) && bars.length > 0 && !kept.has(`eod:bars:${s}`));
  for (let i = 0; i < fresh.length; i += 50) {
    await col.bulkWrite(
      fresh.slice(i, i + 50).map(([s, bars]) => ({
        updateOne: {
          filter: { key: `eod:bars:${s}` },
          update: { $set: { key: `eod:bars:${s}`, data: { fetchedAt: bundle.fetchedAt, bars }, status: "ok", note: `${bars.length} sessions to ${bars[bars.length - 1].date} (seeded)`, updatedAt: new Date() } },
          upsert: true,
        },
      }))
    );
  }
  console.log(`seeded ${fresh.length} series; ${Object.keys(bundle.series).length - fresh.length} already kept`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
