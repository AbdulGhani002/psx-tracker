// Runs ON THE SERVER, fed to node on stdin by scripts/monthly-retrain.sh:
// prints what the strategy model's training reads from the server
// (scripts/macro-inputs.ts, macro-dump.json.gz): the world series it keeps
// (oil, gold, USD/PKR, the S&P 500, emerging markets, the dollar index, the US
// 10-year), PBS's CPI, and the company figures. Plain CommonJS with the
// standalone build's mongoose.
const mongoose = require("mongoose");

const SERIES = { oil: "MACRO:oil", gold: "MACRO:gold", usdpkr: "MACRO:usdpkr", spx: "MACRO:spx", em: "MACRO:em", dxy: "MACRO:dxy", us10y: "MACRO:us10y" };

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  const db = mongoose.connection.db;
  const snaps = db.collection("feedsnapshots");
  const macro = {};
  for (const [name, key] of Object.entries(SERIES)) {
    const d = await snaps.findOne({ key: `eod:bars:${key}` }, { projection: { "data.bars": 1 } });
    macro[name] = (d?.data?.bars ?? []).filter((b) => b && b.close > 0).map((b) => [b.date, b.close]);
  }
  const infl = await snaps.findOne({ key: "inflationPk" }, { projection: { "data.history": 1 } });
  const cpi = (infl?.data?.history ?? []).map((p) => ({ period: p.period, index: p.index }));
  const fund = await db.collection("fundamentals").find({}, { projection: { _id: 0, symbol: 1, sector: 1, annual: 1, fiscalYearEndMonth: 1 } }).toArray();
  process.stdout.write(JSON.stringify({ macro, cpi, fund }));
  await mongoose.disconnect();
})().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
