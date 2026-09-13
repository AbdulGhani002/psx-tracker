// Prints the symbols the server cares about, comma separated: every held name
// across users, plus watchlist and target names. The laptop's daily push asks
// for this list before fetching bars and payout boards.
//   set -a; . /root/psx-tracker-v2/.env.local; set +a; node jobs/held-symbols.js
const mongoose = require("mongoose");

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  const db = mongoose.connection.db;
  const held = await db.collection("holdings").find({ $or: [{ currentShares: { $gt: 0 } }, { targetAllocationPercent: { $gt: 0 } }] }, { projection: { symbol: 1 } }).toArray();
  const watched = await db.collection("watchlistentries").find({}, { projection: { symbol: 1 } }).toArray();
  const syms = new Set([...held, ...watched].map((d) => String(d.symbol || "").toUpperCase()).filter((s) => /^[A-Z0-9]{2,10}$/.test(s)));
  process.stdout.write([...syms].sort().join(",") + "\n");
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
