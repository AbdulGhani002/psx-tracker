// BMA's CashBook report of 24 Sep 2026 (printed 12:41 PM, an image-only PDF
// read from its rendered pages), on Abdul's "add today's buy of shares".
//
// Today's buys, unbilled (T+1, the note comes tomorrow), nine fills:
//   HINOON 5 @ 959.80, 70 @ 959.80, 15 @ 959.00       (90 shares)
//   MUREB 24 @ 938.00, 8 @ 945.00, 1 @ 937.99          (33 shares)
//   MARI 3 @ 649.89
//   AHCL 20 @ 15.77, 9 @ 15.77                        (29 shares, the 3-paisa floor)
// The cashbook gives each fill's brokerage to the paisa; the note will add
// 15% SST on it, estimated here per fill. The note replaces these rows.
// Cash: the day opened at 7.72 CR (the app's balance after the 22 Sep note)
// and two raast payments came in, 30,000 and 90,000. Net cashbook balance
// 40.86 CR before the SST is billed.
//
// Every cashbook amount is re-derived (qty x rate + BRK) and the totals are
// checked against the report's own before anything is written.
//
//   MONGODB_URI=... DRY_RUN=1 node import-bma-cashbook-20260924.mjs
//   MONGODB_URI=... node import-bma-cashbook-20260924.mjs
import mongoose from "mongoose";

const USER_ID = "6a368e470160489b1b496fd1";
const TODAY = "2026-09-24";
const r2 = (v) => Math.round(v * 100 + 1e-9) / 100;
const day = (s) => new Date(`${s}T00:00:00.000Z`);
const dry = process.env.DRY_RUN === "1";

const FILLS = [
  { voucher: "54605746", symbol: "HINOON", qty: 5, rate: 959.8, brk: 7.2, cashbook: 4806.2 },
  { voucher: "54605748", symbol: "HINOON", qty: 70, rate: 959.8, brk: 100.78, cashbook: 67286.78 },
  { voucher: "54605749", symbol: "HINOON", qty: 15, rate: 959.0, brk: 21.58, cashbook: 14406.58 },
  { voucher: "54605777", symbol: "MUREB", qty: 24, rate: 938.0, brk: 33.77, cashbook: 22545.77 },
  { voucher: "54605778", symbol: "MUREB", qty: 8, rate: 945.0, brk: 11.34, cashbook: 7571.34 },
  { voucher: "54605779", symbol: "MUREB", qty: 1, rate: 937.99, brk: 1.41, cashbook: 939.4 },
  { voucher: "54605802", symbol: "MARI", qty: 3, rate: 649.89, brk: 2.92, cashbook: 1952.59 },
  { voucher: "54605821", symbol: "AHCL", qty: 20, rate: 15.77, brk: 0.6, cashbook: 316.0 },
  { voucher: "54605832", symbol: "AHCL", qty: 9, rate: 15.77, brk: 0.27, cashbook: 142.2 },
];
const DEPOSITS = [
  { amount: 30000, notes: "CDC raast payment (BMA voucher GBR02010193)" },
  { amount: 90000, notes: "CDC raast payment (BMA voucher GBR02010288)" },
];
const OPENING = 7.72;
const REPORT_DEBITS = 119966.86;
const REPORT_CREDITS = 120007.72;
const REPORT_BALANCE = 40.86;
const EXPECTED_BEFORE = { HINOON: 239, MUREB: 591, MARI: 216, AHCL: 20983 };

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

let broken = 0;
const check = (label, got, want) => {
  const ok = Math.abs(got - want) < 0.005;
  if (!ok) broken++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label.padEnd(26)} ${got.toFixed(2).padStart(11)} vs ${want.toFixed(2).padStart(11)}`);
};
console.log("cashbook of 24 Sep 2026:");
for (const f of FILLS) {
  check(`${f.symbol} ${f.qty} brokerage`, r2(Math.max(f.qty * f.rate * 0.0015, f.qty * 0.03)), f.brk);
  check(`${f.symbol} ${f.qty} amount`, r2(f.qty * f.rate + f.brk), f.cashbook);
}
const debits = r2(FILLS.reduce((s, f) => s + f.cashbook, 0));
const credits = r2(OPENING + DEPOSITS.reduce((s, d) => s + d.amount, 0));
check("total debits", debits, REPORT_DEBITS);
check("total credits", credits, REPORT_CREDITS);
check("net cashbook balance", r2(credits - debits), REPORT_BALANCE);
if (broken > 0) {
  console.error(`REFUSING TO WRITE: ${broken} figure(s) do not match the cashbook.`);
  process.exit(1);
}
console.log("every figure reconciles to the cashbook.\n");

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection;
const txCol = db.collection("transactions");
const hCol = db.collection("holdings");
const cashCol = db.collection("cashentries");
const portfolio = await db.collection("portfolios").findOne({ userId: USER_ID, isDefault: true });
const portfolioId = portfolio ? String(portfolio._id) : "";

const already = await txCol.find({ userId: USER_ID, date: day(TODAY), deletedAt: null, type: { $in: ["BUY", "SELL"] } }).toArray();
if (already.length > 0) await fail(`${already.length} trade row(s) dated ${TODAY} already exist: ${already.map((o) => `${o.type} ${o.symbol} ${o.shares} @ ${o.pricePerShare}`).join(", ")}.`);
for (const d of DEPOSITS) {
  const dupe = await cashCol.findOne({ userId: USER_ID, type: "DEPOSIT", date: day(TODAY), amount: d.amount });
  if (dupe) await fail(`a deposit of ${d.amount} on ${TODAY} already exists (_id ${dupe._id}).`);
}
for (const symbol of Object.keys(EXPECTED_BEFORE)) {
  const d = derive(await txCol.find({ userId: USER_ID, symbol, deletedAt: null }).sort({ date: 1, createdAt: 1 }).toArray());
  if (Math.abs(d.shares - EXPECTED_BEFORE[symbol]) > 1e-6) await fail(`the ledger holds ${d.shares} ${symbol}, expected ${EXPECTED_BEFORE[symbol]}.`);
  console.log(`before: ${symbol.padEnd(6)} ${String(d.shares).padStart(6)} shares, avg ${d.avgCost.toFixed(2)}`);
}

const rows = FILLS.map((f) => {
  const sst = r2(f.brk * 0.15);
  return { ...f, sst, fees: r2(f.brk + sst), gross: r2(f.qty * f.rate), net: r2(f.qty * f.rate + f.brk + sst) };
});
console.log("\nwould write:");
for (const r of rows) console.log(`  BUY ${r.symbol.padEnd(6)} ${String(r.qty).padStart(3)} @ ${r.rate}: brokerage ${r.brk.toFixed(2)}, SST est ${r.sst.toFixed(2)}, net ${r.net.toFixed(2)}`);
for (const d of DEPOSITS) console.log(`  DEPOSIT ${d.amount.toFixed(2)}: ${d.notes}`);
const sstTotal = r2(rows.reduce((s, r) => s + r.sst, 0));
console.log(`  SST estimated in all ${sstTotal.toFixed(2)}; BMA's balance after it is billed: ${r2(REPORT_BALANCE - sstTotal).toFixed(2)}`);

if (dry) {
  console.log("\n[DRY RUN] nothing written.");
  await mongoose.disconnect();
  process.exit(0);
}

const now = new Date();
for (const [i, r] of rows.entries()) {
  await txCol.insertOne({
    userId: USER_ID, portfolioId, symbol: r.symbol, type: "BUY", date: day(TODAY), shares: r.qty, pricePerShare: r.rate,
    totalAmount: r.gross, fees: r.fees, netAmount: r.net,
    notes: `BMA cashbook 24 Sep 2026, trade ${r.voucher}: brokerage ${r.brk.toFixed(2)} exact, SST estimated at 15%; the contract note replaces these figures`,
    ratio: "", taxDeducted: 0, zakatDeducted: 0, financialYear: "", dividendType: "", source: "import", deletedAt: null,
    createdAt: new Date(now.getTime() + i), updatedAt: now, __v: 0,
  });
}
for (const d of DEPOSITS) await cashCol.insertOne({ userId: USER_ID, portfolioId, date: day(TODAY), type: "DEPOSIT", amount: d.amount, notes: d.notes, createdAt: now, updatedAt: now, __v: 0 });
console.log("\nwritten.");
for (const symbol of Object.keys(EXPECTED_BEFORE)) {
  const d = derive(await txCol.find({ userId: USER_ID, symbol, deletedAt: null }).sort({ date: 1, createdAt: 1 }).toArray());
  await hCol.updateOne({ userId: USER_ID, symbol }, { $set: { currentShares: d.shares, avgCostBasis: d.avgCost, totalCost: d.totalCost, realizedPL: d.realizedPL, totalDividendsReceived: d.dividendsReceived, updatedAt: now } });
  console.log(`after:  ${symbol.padEnd(6)} ${String(d.shares).padStart(6)} shares, avg ${d.avgCost.toFixed(2)}, cost ${d.totalCost.toFixed(2)}`);
}
await mongoose.disconnect();
