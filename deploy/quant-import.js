// Put a trained model (or any quant result) into the feed store on the server.
// The model is trained on Abdul's machine and only the JSON travels:
//
//   set -a; . /root/psx-tracker-v2/.env.local; set +a
//   node /root/psx-tracker-v2/jobs/quant-import.js /root/quant-model.json            # key quant:model
//   node /root/psx-tracker-v2/jobs/quant-import.js /root/long.json quant:validation:long
//
// Plain CommonJS so it runs with the mongoose the standalone build already
// carries; no build step.
const fs = require("fs");
const mongoose = require("mongoose");

(async () => {
  const [file, key = "quant:model"] = process.argv.slice(2);
  if (!file) throw new Error("usage: quant-import.js FILE [KEY]");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (key === "quant:model" && (data.version !== 2 || !Array.isArray(data.learners) || data.learners.length === 0)) {
    throw new Error("not a stored quant model (version 2 with learners)");
  }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  const col = mongoose.connection.db.collection("feedsnapshots");
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
