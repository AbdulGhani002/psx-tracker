// Abdul, 21 Sep 2026: "add MUREB 213 buy 937.64 including commission ... and
// sell all MF positions".
//
// 1. Every mutual fund position is redeemed in full at the last NAV MUFAP
//    published (the fund's own confirmation gives the exact redemption NAV;
//    edit the trade if it differs). The gain over the units' average cost is
//    kept on the trade. The proceeds are recorded as deposits into the
//    brokerage cash ledger, since the money is what pays for the shares.
// 2. BUY 213 MUREB. 937.64 is the rate including commission, the way the
//    broker's app shows it; BMA charges 0.15%, so the market rate is the one
//    that gives 937.64 after commission: 936.24 (936.24 x 0.0015 = 1.4044,
//    936.24 + 1.4044 = 937.6444). 936.23 gives 937.63 and 936.25 gives 937.65,
//    so 936.24 is the only rate that fits. Commission on the line 299.13,
//    SST 15% 44.87, net 199,763.12. The contract note replaces these figures.
//
//   MONGODB_URI=... DRY_RUN=1 node redeem-funds-buy-mureb-20260921.mjs
//   MONGODB_URI=... node redeem-funds-buy-mureb-20260921.mjs
import mongoose from "mongoose";

const USER_ID = "6a368e470160489b1b496fd1";
const DAY = "2026-09-21";
const TRADE_DATE = new Date(`${DAY}T00:00:00.000Z`);
const MUREB = { qty: 213, netRateQuoted: 937.64, marketRate: 936.24, expectedBefore: 253 };
const COMMISSION_RATE = 0.0015;
const COMMISSION_FLOOR = 0.03;
const SST_RATE = 0.15;

const r2 = (v) => Math.round(v * 100 + 1e-9) / 100;
const r4 = (v) => Math.round(v * 10000 + 1e-9) / 10000;
const dry = process.env.DRY_RUN === "1";
const daysBetween = (a, b) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000));

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

const fail = async (msg) => {
  console.error(`REFUSING TO WRITE: ${msg}`);
  await mongoose.disconnect();
  process.exit(1);
};

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection;
const portfolio = await db.collection("portfolios").findOne({ userId: USER_ID, isDefault: true });
const portfolioId = portfolio ? String(portfolio._id) : "";

// The MUREB line, checked against the quoted all-in rate.
const commPerShare = r4(Math.max(MUREB.marketRate * COMMISSION_RATE, COMMISSION_FLOOR));
if (r2(MUREB.marketRate + commPerShare) !== MUREB.netRateQuoted) await fail(`${MUREB.marketRate} + ${commPerShare} does not give the quoted ${MUREB.netRateQuoted}.`);
const gross = r2(MUREB.qty * MUREB.marketRate);
const commission = r2(Math.max(MUREB.qty * MUREB.marketRate * COMMISSION_RATE, MUREB.qty * COMMISSION_FLOOR));
const sst = r2(commission * SST_RATE);
const fees = r2(commission + sst);
const net = r2(gross + fees);
const murebBefore = derive(await db.collection("transactions").find({ userId: USER_ID, symbol: "MUREB", deletedAt: null }).sort({ date: 1, createdAt: 1 }).toArray());
if (Math.abs(murebBefore.shares - MUREB.expectedBefore) > 1e-6) await fail(`the ledger holds ${murebBefore.shares} MUREB, expected ${MUREB.expectedBefore}.`);
const dupe = await db.collection("transactions").findOne({ userId: USER_ID, symbol: "MUREB", type: "BUY", date: TRADE_DATE, shares: MUREB.qty, deletedAt: null });
if (dupe) await fail(`a BUY MUREB ${MUREB.qty} dated ${DAY} already exists (_id ${dupe._id}).`);
console.log(`MUREB: ${murebBefore.shares} held at avg ${murebBefore.avgCost.toFixed(2)}`);
console.log(`BUY ${MUREB.qty} MUREB @ ${MUREB.marketRate} (quoted ${MUREB.netRateQuoted} incl. ${commPerShare}/share): gross ${gross.toFixed(2)}, commission ${commission.toFixed(2)}, SST ${sst.toFixed(2)}, fees ${fees.toFixed(2)}, net ${net.toFixed(2)}`);

// The funds, at the last published NAV.
const snap = await db.collection("feedsnapshots").findOne({ key: "mufapNavs" });
const navs = snap?.data?.navs ?? [];
const navAsOf = snap?.data?.at ?? "";
if (navs.length === 0) await fail("no MUFAP NAV snapshot on the server.");
const funds = await db.collection("mutualfunds").find({ userId: USER_ID, units: { $gt: 0 } }).toArray();
if (funds.length === 0) await fail("no fund position with units to redeem.");
const redemptions = [];
for (const f of funds) {
  const entry = navs.find((n) => String(n.name).toLowerCase() === String(f.mufapName).toLowerCase());
  if (!entry || !(entry.nav > 0)) await fail(`no NAV for ${f.mufapName} in the snapshot of ${navAsOf}.`);
  let units = Number(f.units) || 0;
  const daily = f.fundType === "dailyDividend" && f.anchorDate && (f.annualYieldPct ?? 0) > 0;
  if (daily) units = units * Math.pow(Math.pow(1 + f.annualYieldPct / 100, 1 / 365), daysBetween(f.anchorDate, DAY));
  const nav = Number(entry.nav);
  const amount = r2(units * nav);
  const realizedGain = r2(amount - units * (Number(f.avgCost) || 0));
  redemptions.push({ f, units, nav, amount, realizedGain });
  console.log(`REDEEM ${f.name}: ${units.toFixed(4)} units x NAV ${nav} (${navAsOf}) = ${amount.toFixed(2)}, gain over cost ${realizedGain >= 0 ? "+" : ""}${realizedGain.toFixed(2)}`);
}
const proceeds = r2(redemptions.reduce((s, r) => s + r.amount, 0));
const cashDupe = await db.collection("cashentries").findOne({ userId: USER_ID, date: TRADE_DATE, type: "DEPOSIT", notes: /Redemption of/ });
if (cashDupe) await fail(`a redemption deposit dated ${DAY} already exists (_id ${cashDupe._id}).`);
console.log(`proceeds ${proceeds.toFixed(2)} into brokerage cash; after the MUREB buy the ledger cash moves by ${(proceeds - net).toFixed(2)}`);

if (dry) {
  console.log("\n[DRY RUN] nothing written.");
  await mongoose.disconnect();
  process.exit(0);
}

const now = new Date();
for (const r of redemptions) {
  await db.collection("mutualfunds").updateOne(
    { _id: r.f._id },
    {
      $set: { units: 0, updatedAt: now, ...(r.f.fundType === "dailyDividend" ? { anchorDate: DAY } : {}) },
      $push: { trades: { _id: new mongoose.Types.ObjectId(), date: TRADE_DATE, side: "REDEEM", units: r.units, nav: r.nav, amount: r.amount, realizedGain: r.realizedGain, notes: `All units redeemed at the last published NAV (${navAsOf}); the fund's confirmation gives the exact figure` } },
    }
  );
  await db.collection("cashentries").insertOne({
    userId: USER_ID, portfolioId, date: TRADE_DATE, type: "DEPOSIT", amount: r.amount,
    notes: `Redemption of ${r.f.name}: ${r.units.toFixed(4)} units at NAV ${r.nav}`,
    createdAt: now, updatedAt: now, __v: 0,
  });
  console.log(`redeemed ${r.f.name}; deposit ${r.amount.toFixed(2)} recorded.`);
}
await db.collection("transactions").insertOne({
  userId: USER_ID, portfolioId, symbol: "MUREB", type: "BUY", date: TRADE_DATE, shares: MUREB.qty, pricePerShare: MUREB.marketRate,
  totalAmount: gross, fees, netAmount: net,
  notes: `Typed from the broker app: ${MUREB.netRateQuoted} a share including commission; market rate backed out at BMA's 0.15% (${MUREB.marketRate} + ${commPerShare}); the contract note replaces these figures`,
  ratio: "", taxDeducted: 0, zakatDeducted: 0, financialYear: "", dividendType: "", source: "", deletedAt: null, createdAt: now, updatedAt: now, __v: 0,
});
const after = derive(await db.collection("transactions").find({ userId: USER_ID, symbol: "MUREB", deletedAt: null }).sort({ date: 1, createdAt: 1 }).toArray());
await db.collection("holdings").updateOne({ userId: USER_ID, symbol: "MUREB" }, { $set: { currentShares: after.shares, avgCostBasis: after.avgCost, totalCost: after.totalCost, realizedPL: after.realizedPL, totalDividendsReceived: after.dividendsReceived, updatedAt: now } });
console.log(`MUREB now ${after.shares} shares at avg ${after.avgCost.toFixed(2)}, cost ${after.totalCost.toFixed(2)}`);
await mongoose.disconnect();
