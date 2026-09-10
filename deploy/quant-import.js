// Put a trained model, a bars bundle, or any quant result into the feed store
// on the server. Everything is produced on Abdul's machine; only JSON travels:
//
//   set -a; . /root/psx-tracker-v2/.env.local; set +a
//   node jobs/quant-import.js /root/quant-model.json                       # key quant:model
//   node jobs/quant-import.js /root/long.json quant:validation:long        # any key
//   node jobs/quant-import.js /root/bars-bundle.json --bars                # eod:bars:SYMBOL, one per series
//
// Plain CommonJS so it runs with the mongoose the standalone build already
// carries; no build step.
const fs = require("fs");
const mongoose = require("mongoose");

(async () => {
  const [file, keyArg] = process.argv.slice(2);
  if (!file) throw new Error("usage: quant-import.js FILE [KEY | --bars]");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  const col = mongoose.connection.db.collection("feedsnapshots");

  if (keyArg === "--bars") {
    // {fetchedAt, series: {SYMBOL: bars[]}} -> one eod:bars:SYMBOL document each,
    // in the shape lib/quant/store.ts reads ({fetchedAt, bars}).
    if (!data || typeof data.series !== "object" || !data.fetchedAt) throw new Error("not a bars bundle");
    const ops = Object.entries(data.series)
      .filter(([, bars]) => Array.isArray(bars) && bars.length > 0)
      .map(([symbol, bars]) => ({
        updateOne: {
          filter: { key: `eod:bars:${symbol}` },
          update: { $set: { key: `eod:bars:${symbol}`, data: { fetchedAt: data.fetchedAt, bars }, status: "ok", note: `${bars.length} sessions to ${bars[bars.length - 1].date} (pushed)`, updatedAt: new Date() } },
          upsert: true,
        },
      }));
    if (ops.length) await col.bulkWrite(ops, { ordered: false });
    const kse = data.series.KSE100;
    console.log(`bars: ${ops.length} series written, fetched ${data.fetchedAt}${kse ? `, KSE-100 to ${kse[kse.length - 1].date}` : ""}`);
    await mongoose.disconnect();
    return;
  }

  const key = keyArg || "quant:model";
  if (key === "quant:model" && (data.version !== 2 || !Array.isArray(data.learners) || data.learners.length === 0)) {
    throw new Error("not a stored quant model (version 2 with learners)");
  }
  const note =
    key === "quant:model"
      ? `${data.rows} rows, ${data.universe.length} names, horizon ${data.horizon}, trained ${data.trainedOn}`
      : `${key} imported ${new Date().toISOString()}`;
  await col.updateOne({ key }, { $set: { key, data, status: "ok", note, updatedAt: new Date() } }, { upsert: true });
  const back = await col.findOne({ key }, { projection: { note: 1, updatedAt: 1 } });
  console.log(`${key}: ${back.note} (${(fs.statSync(file).size / 1024).toFixed(0)} KiB)`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
