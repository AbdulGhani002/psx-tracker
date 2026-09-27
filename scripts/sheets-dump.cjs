// Runs ON THE SERVER, fed to node on stdin by scripts/sheets-pull.sh: prints
// the end-of-day files the server keeps (lib/quant/sheet-bars.ts) from a date
// on, as one JSON array of {date, rows, holiday}. Plain CommonJS with the
// mongoose the standalone build carries, so nothing has to be deployed for it.
const mongoose = require("mongoose");

(async () => {
  const from = process.argv.slice(2).find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || "2026-01-01";
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  const col = mongoose.connection.db.collection("feedsnapshots");
  const docs = await col.find({ key: { $gte: "dps:closing:" + from, $lt: "dps:closing:~" } }).sort({ key: 1 }).toArray();
  process.stdout.write(JSON.stringify(docs.map((d) => ({ date: d.data.date, rows: d.data.rows || [], holiday: !!d.data.holiday }))));
  await mongoose.disconnect();
})().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
