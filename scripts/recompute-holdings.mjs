// Rebuild every Holding's derived fields from the transaction ledger.
//
// Holding.currentShares / avgCostBasis / totalCost / realizedPL /
// totalDividendsReceived are a CACHE of the ledger, never an independent
// record. The API routes refresh them after every write, but the one-off import
// scripts (note 53691360, the 19-Aug manual buys) inserted transactions and
// left the cache alone — so five positions drifted, and ABL sat at zero shares
// while 250 of them were on the ledger.
//
// The walk here is the same one lib/calculations/holding.ts does: average cost,
// a sale removing cost in proportion and leaving the average untouched, bonus
// shares diluting it, a split scaling the count only.
//
// Idempotent: run it whenever a script has written transactions directly.
//
//   MONGODB_URI=... DRY_RUN=1 node scripts/recompute-holdings.mjs
//   MONGODB_URI=... node scripts/recompute-holdings.mjs
//
import mongoose from "mongoose";

const USER_ID = process.env.USER_ID || "6a368e470160489b1b496fd1";

const uri = process.env.MONGODB_URI;
const dry = process.env.DRY_RUN === "1";
if (!uri) {
  console.error("MONGODB_URI is required.");
  process.exit(1);
}

function derive(txs) {
  // Sort by date only, exactly as deriveFromTransactions does; the query
  // already returns createdAt order, and a stable sort keeps it inside a day.
  const sorted = [...txs].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  let shares = 0, totalCost = 0, avgCost = 0, realizedPL = 0, dividendsReceived = 0;
  for (const tx of sorted) {
    switch (tx.type) {
      case "BUY":
        shares += tx.shares;
        totalCost += tx.netAmount;
        avgCost = shares > 0 ? totalCost / shares : 0;
        break;
      case "SELL": {
        const sold = Math.abs(tx.shares);
        if (shares <= 0 || sold <= 0) break;
        const proportion = Math.min(1, sold / shares);
        const costRemoved = totalCost * proportion;
        realizedPL += tx.netAmount - costRemoved;
        totalCost -= costRemoved;
        shares -= sold;
        avgCost = shares > 0 ? totalCost / shares : 0;
        break;
      }
      case "DIVIDEND":
        dividendsReceived += tx.netAmount;
        break;
      case "BONUS":
        shares += tx.shares;
        avgCost = shares > 0 ? totalCost / shares : 0;
        break;
      case "RIGHT":
        shares += tx.shares;
        totalCost += tx.netAmount;
        avgCost = shares > 0 ? totalCost / shares : 0;
        break;
      case "SPLIT": {
        const [from, to] = String(tx.ratio ?? "").split(":").map((s) => Number(String(s).trim()));
        if (from && to) shares *= to / from;
        avgCost = shares > 0 ? totalCost / shares : 0;
        break;
      }
    }
  }
  return { shares, totalCost, avgCost, realizedPL, dividendsReceived };
}

const run = async () => {
  await mongoose.connect(uri);
  const hCol = mongoose.connection.collection("holdings");
  const txCol = mongoose.connection.collection("transactions");

  const holdings = await hCol.find({ userId: USER_ID }).sort({ symbol: 1 }).toArray();
  const drifted = [];

  for (const h of holdings) {
    const txs = await txCol
      .find({ userId: USER_ID, symbol: h.symbol, deletedAt: null })
      .sort({ date: 1, createdAt: 1 })
      .toArray();
    const d = derive(txs);
    const sameShares = Math.abs((h.currentShares ?? 0) - d.shares) < 0.001;
    const sameCost = Math.abs((h.totalCost ?? 0) - d.totalCost) < 0.01;
    if (sameShares && sameCost) continue;
    drifted.push({ h, d });
    console.log(
      `${h.symbol.padEnd(8)} shares ${String(h.currentShares ?? 0).padStart(7)} -> ${d.shares
        .toFixed(0)
        .padStart(7)}   cost ${(h.totalCost ?? 0).toFixed(2).padStart(12)} -> ${d.totalCost.toFixed(2).padStart(12)}   avg ${d.avgCost.toFixed(2)}`
    );
  }

  if (drifted.length === 0) {
    console.log("every holding already matches the ledger — nothing to do.");
    await mongoose.disconnect();
    return;
  }
  console.log(`\n${drifted.length} holding(s) drifted from the ledger.`);

  if (dry) {
    console.log("[DRY RUN] nothing written.");
    await mongoose.disconnect();
    return;
  }

  const now = new Date();
  for (const { h, d } of drifted) {
    await hCol.updateOne(
      { _id: h._id },
      {
        $set: {
          currentShares: d.shares,
          avgCostBasis: d.avgCost,
          totalCost: d.totalCost,
          realizedPL: d.realizedPL,
          totalDividendsReceived: d.dividendsReceived,
          updatedAt: now,
        },
      }
    );
  }
  console.log(`rewrote ${drifted.length} holding(s) from the ledger.`);
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("recompute failed:", err);
  process.exit(1);
});
