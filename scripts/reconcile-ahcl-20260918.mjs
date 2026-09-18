// Reconciling buy of 20 AHCL at 14.50, on Abdul's instruction of 18 Sep 2026
// ("add AHCL at 14.50"): the CDC balances of that day (investor account
// 165555 + BMA sub-account 254102) show 20,954 AHCL against a ledger of
// 20,934. Dated 11 Sep 2026, the day AHCL traded at 14.50 on his BMA note.
// Fees at BMA's rate: 0.15% with the 3-paisa floor (14.50 x 0.15% = 2.2 paisa,
// so the floor applies), plus 15% SST.
import mongoose from "mongoose";

const USER_ID = "6a368e470160489b1b496fd1";
const SYMBOL = "AHCL";
const QTY = 20;
const RATE = 14.5;
const DATE = new Date("2026-09-11T00:00:00.000Z");
const EXPECTED_BEFORE = 20934;

const r2 = (v) => Math.round(v * 100 + 1e-9) / 100;
const dry = process.env.DRY_RUN === "1";

function derive(txs) {
  let shares = 0, totalCost = 0, realizedPL = 0, dividendsReceived = 0;
  for (const t of txs) {
    if (t.type === "BUY" || t.type === "RIGHT") { shares += t.shares; totalCost += t.netAmount; }
    else if (t.type === "SELL") {
      const sold = Math.abs(t.shares);
      if (shares <= 0 || sold <= 0) continue;
      const proportion = Math.min(1, sold / shares);
      const costRemoved = totalCost * proportion;
      realizedPL += t.netAmount - costRemoved; totalCost -= costRemoved; shares -= sold;
    } else if (t.type === "DIVIDEND") dividendsReceived += t.netAmount;
    else if (t.type === "BONUS") shares += t.shares;
  }
  return { shares, totalCost, realizedPL, dividendsReceived, avgCost: shares > 0 ? totalCost / shares : 0 };
}

await mongoose.connect(process.env.MONGODB_URI);
const txCol = mongoose.connection.collection("transactions");
const hCol = mongoose.connection.collection("holdings");
const portfolio = await mongoose.connection.collection("portfolios").findOne({ userId: USER_ID, isDefault: true });
const before = derive(await txCol.find({ userId: USER_ID, symbol: SYMBOL, deletedAt: null }).sort({ date: 1, createdAt: 1 }).toArray());
if (Math.abs(before.shares - EXPECTED_BEFORE) > 1e-6) {
  console.error(`REFUSING TO WRITE: the ledger holds ${before.shares} ${SYMBOL}, expected ${EXPECTED_BEFORE}.`);
  await mongoose.disconnect(); process.exit(1);
}
const gross = r2(QTY * RATE);
const commission = r2(Math.max(QTY * RATE * 0.0015, QTY * 0.03));
const sst = r2(commission * 0.15);
const fees = r2(commission + sst);
const net = r2(gross + fees);
console.log(`before: ${before.shares} ${SYMBOL}, avg ${before.avgCost.toFixed(2)}`);
console.log(`BUY ${QTY} ${SYMBOL} @ ${RATE}: gross ${gross.toFixed(2)}, commission ${commission.toFixed(2)}, SST ${sst.toFixed(2)}, fees ${fees.toFixed(2)}, net ${net.toFixed(2)}, dated ${DATE.toISOString().slice(0, 10)}`);
if (dry) { console.log("[DRY RUN] nothing written."); await mongoose.disconnect(); process.exit(0); }
const now = new Date();
await txCol.insertOne({
  userId: USER_ID, portfolioId: portfolio ? String(portfolio._id) : "", symbol: SYMBOL, type: "BUY", date: DATE,
  shares: QTY, pricePerShare: RATE, totalAmount: gross, fees, netAmount: net,
  notes: "Reconciliation to the CDC balances of 18 Sep 2026 (investor account 165555 + BMA 254102 held 20,954 AHCL, the ledger 20,934); rate 14.50 given by Abdul, fees at BMA's rate, date is the day AHCL traded at 14.50 on his note",
  ratio: "", taxDeducted: 0, zakatDeducted: 0, financialYear: "", dividendType: "", source: "reconcile", deletedAt: null, createdAt: now, updatedAt: now, __v: 0,
});
const after = derive(await txCol.find({ userId: USER_ID, symbol: SYMBOL, deletedAt: null }).sort({ date: 1, createdAt: 1 }).toArray());
await hCol.updateOne({ userId: USER_ID, symbol: SYMBOL }, { $set: { currentShares: after.shares, avgCostBasis: after.avgCost, totalCost: after.totalCost, realizedPL: after.realizedPL, totalDividendsReceived: after.dividendsReceived, updatedAt: now } });
console.log(`after:  ${after.shares} ${SYMBOL}, avg ${after.avgCost.toFixed(2)}, total cost ${after.totalCost.toFixed(2)}`);
await mongoose.disconnect();
