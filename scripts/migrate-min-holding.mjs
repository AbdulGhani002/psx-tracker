// One-time migration: watchlist minSellShares -> minHoldingShares.
//
// The field was introduced as a gate ("do not suggest a sell unless I hold more
// than this") and reinterpreted as a floor ("this is the core I always keep;
// only the excess is ever sold"). The NUMBER the owner entered means the same
// thing under both readings — it is the size below which nothing is offered —
// so the values copy across unchanged. Only the name and what the app does with
// it have changed.
//
// Idempotent: rows already carrying a non-zero minHoldingShares are left alone,
// and the old field is kept so an older build could still be rolled back.
//
//   MONGODB_URI=... node scripts/migrate-min-holding.mjs
//   MONGODB_URI=... DRY_RUN=1 node scripts/migrate-min-holding.mjs
//
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI;
const dry = process.env.DRY_RUN === "1";
if (!uri) {
  console.error("MONGODB_URI is required.");
  process.exit(1);
}

const run = async () => {
  await mongoose.connect(uri);
  const col = mongoose.connection.collection("watchlistentries");

  const all = await col.find({}).toArray();
  console.log(`${all.length} watchlist row${all.length === 1 ? "" : "s"} found.`);

  let copied = 0;
  let already = 0;
  let nothing = 0;
  for (const doc of all) {
    const old = typeof doc.minSellShares === "number" ? doc.minSellShares : 0;
    const current = typeof doc.minHoldingShares === "number" ? doc.minHoldingShares : 0;
    if (current > 0) {
      already++;
      console.log(`  ${doc.symbol}: already has minHoldingShares=${current}, left alone.`);
      continue;
    }
    if (!(old > 0)) {
      nothing++;
      continue;
    }
    console.log(`  ${doc.symbol}: minSellShares=${old} -> minHoldingShares=${old}`);
    if (!dry) {
      await col.updateOne({ _id: doc._id }, { $set: { minHoldingShares: old } });
    }
    copied++;
  }

  console.log(
    `${dry ? "[DRY RUN] would copy" : "copied"} ${copied}; ${already} already migrated; ${nothing} had no floor set.`
  );
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("migration failed:", err);
  process.exit(1);
});
