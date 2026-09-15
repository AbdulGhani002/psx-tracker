// Sells recorded at the market rate, on Abdul's instruction of 15 Sep 2026
// ("sell trades of all luck and indu at current market rate"), before the
// broker's contract note exists: LUCK, the whole position, and INDU, the whole
// position, at the exchange portal's quote of 10:20 AM PKT that day.
//
// Fees are the app's own estimate (BMA 0.15% with the 3-paisa floor, plus
// 15% SST), the same figure the trade form would fill in. The contract note,
// when it arrives, carries the exact commission; import it and it replaces
// these rows (the note-import scripts refuse a duplicate, so delete these
// first or edit them to the note's figures).
//
// The script refuses to write unless the ledger holds exactly the shares
// being sold, and refuses if a sale of that size at that price is already
// dated today.
//
//   MONGODB_URI=... DRY_RUN=1 node sell-at-market-20260915.mjs
//   MONGODB_URI=... node sell-at-market-20260915.mjs
//
import mongoose from "mongoose";

const USER_ID = "6a368e470160489b1b496fd1";
const TRADE_DATE = new Date("2026-09-15T00:00:00.000Z");
const QUOTE_TIME = "15 Sep 2026 10:20 PKT, dps.psx.com.pk";
const RATE = 0.0015;
const FLOOR = 0.03;
const SST = 0.15;

const SELLS = [
  { symbol: "LUCK", qty: 376, marketRate: 410.79 },
  { symbol: "INDU", qty: 28, marketRate: 1816.98 },
];

const r2 = (v) => Math.round(v * 100 + 1e-9) / 100;
const uri = process.env.MONGODB_URI;
const dry = process.env.DRY_RUN === "1";
if (!uri) {
  console.error("MONGODB_URI is required.");
  process.exit(1);
}

function derive(txs) {
  let shares = 0, totalCost = 0, realizedPL = 0, dividendsReceived = 0;
  for (const t of txs) {
    if (t.type === "BUY" || t.type === "RIGHT") {
      shares += t.shares;
      totalCost += t.netAmount;
    } else if (t.type === "SELL") {
      const sold = Math.abs(t.shares);
      if (shares <= 0 || sold <= 0) continue;
      const proportion = Math.min(1, sold / shares);
      const costRemoved = totalCost * proportion;
      realizedPL += t.netAmount - costRemoved;
      totalCost -= costRemoved;
      shares -= sold;
    } else if (t.type === "DIVIDEND") dividendsReceived += t.netAmount;
    else if (t.type === "BONUS") shares += t.shares;
    else if (t.type === "SPLIT") {
      const [from, to] = String(t.ratio ?? "").split(":").map((x) => Number(String(x).trim()));
      if (from && to) shares *= to / from;
    }
  }
  return { shares, totalCost, realizedPL, dividendsReceived, avgCost: shares > 0 ? totalCost / shares : 0 };
}

const run = async () => {
  await mongoose.connect(uri);
  const txCol = mongoose.connection.collection("transactions");
  const hCol = mongoose.connection.collection("holdings");
  const portfolio = await mongoose.connection.collection("portfolios").findOne({ userId: USER_ID, isDefault: true });
  const portfolioId = portfolio ? String(portfolio._id) : "";

  const rows = [];
  for (const s of SELLS) {
    const gross = r2(s.qty * s.marketRate);
    const commission = r2(Math.max(s.qty * s.marketRate * RATE, s.qty * FLOOR));
    const sst = r2(commission * SST);
    const fees = r2(commission + sst);
    const net = r2(gross - fees);
    const holding = await hCol.findOne({ userId: USER_ID, symbol: s.symbol });
    if (!holding) {
      console.error(`REFUSING TO WRITE: no ${s.symbol} holding.`);
      process.exit(1);
    }
    const ledger = derive(await txCol.find({ userId: USER_ID, symbol: s.symbol, deletedAt: null }).sort({ date: 1, createdAt: 1 }).toArray());
    if (Math.abs(ledger.shares - s.qty) > 1e-6) {
      console.error(`REFUSING TO WRITE: the ledger holds ${ledger.shares} ${s.symbol}, not ${s.qty}. "All" means the ledger's figure; fix the quantity first.`);
      process.exit(1);
    }
    const dupe = await txCol.findOne({ userId: USER_ID, symbol: s.symbol, type: "SELL", date: TRADE_DATE, deletedAt: null });
    if (dupe) {
      console.error(`REFUSING TO WRITE: a ${s.symbol} sale dated 15 Sep 2026 already exists (_id ${dupe._id}).`);
      process.exit(1);
    }
    const realised = r2(net - ledger.totalCost);
    rows.push({ ...s, gross, commission, sst, fees, net, before: ledger, realised });
    console.log(`${s.symbol}: ${s.qty} x ${s.marketRate} = ${gross.toFixed(2)} gross, commission ${commission.toFixed(2)} + SST ${sst.toFixed(2)} = fees ${fees.toFixed(2)}, net ${net.toFixed(2)}`);
    console.log(`  held ${ledger.shares} at avg ${ledger.avgCost.toFixed(2)} (cost ${ledger.totalCost.toFixed(2)}); realised on this sale ${realised >= 0 ? "+" : ""}${realised.toFixed(2)}`);
  }

  if (dry) {
    console.log("\n[DRY RUN] nothing written.");
    await mongoose.disconnect();
    return;
  }

  const now = new Date();
  for (const row of rows) {
    await txCol.insertOne({
      userId: USER_ID,
      portfolioId,
      symbol: row.symbol,
      type: "SELL",
      date: TRADE_DATE,
      shares: -row.qty,
      pricePerShare: row.marketRate,
      totalAmount: row.gross,
      fees: row.fees,
      netAmount: row.net,
      notes: `Sold the whole position at the market rate (${QUOTE_TIME}); fees estimated at BMA's rate, the contract note replaces them`,
      ratio: "",
      taxDeducted: 0,
      zakatDeducted: 0,
      financialYear: "",
      dividendType: "",
      source: "",
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      __v: 0,
    });
    const after = derive(await txCol.find({ userId: USER_ID, symbol: row.symbol, deletedAt: null }).sort({ date: 1, createdAt: 1 }).toArray());
    await hCol.updateOne({ userId: USER_ID, symbol: row.symbol }, { $set: { currentShares: after.shares, avgCostBasis: after.avgCost, totalCost: after.totalCost, realizedPL: after.realizedPL, totalDividendsReceived: after.dividendsReceived, updatedAt: now } });
    console.log(`inserted SELL ${row.symbol} ${row.qty} @ ${row.marketRate}, net ${row.net.toFixed(2)}; position now ${after.shares} shares, realised to date ${after.realizedPL.toFixed(2)}`);
  }
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("failed:", err);
  process.exit(1);
});
