// BMA's CashBook report of 22 Sep 2026 (1 Sep to 22 Sep, printed 10:51 AM),
// on Abdul's "add today's buy of shares".
//
// 1. Today's buys, unbilled (T+1, the note comes tomorrow): MEBL 150 @ 552.20
//    in six fills and MUREB 125 @ 933.00 in two. The cashbook gives the
//    brokerage of every fill to the paisa; the note will add 15% SST on it,
//    which is estimated here per fill. The note replaces these rows.
// 2. The cash ledger of September, from the same report: the opening balance
//    of 828.04 on 1 Sep, the raast deposits (15,000 on 7 Sep, 2,000 on 9 Sep,
//    21,000 on 11 Sep, 35,500 on 14 Sep, 200,000 on 21 Sep, 200,000 on 22
//    Sep), the custody charge of 1.00. The two "redemption" deposits written
//    on 21 Sep are removed: the fund money went to the bank, and what reached
//    BMA is the raast payments above. NCCPL's CGT charge (360.30 on 3 Sep) is
//    not booked: the app already holds an estimate of the tax back out of each
//    sale's proceeds, and booking the charge too would count it twice.
// 3. The 9 Sep rows typed from the app (AHCL 45 @ 15.72, PTL 110 @ 51.97) had
//    the net rate as the price and an estimate on top; replaced with the
//    cashbook's fills: AHCL 1 + 44 @ 15.69, PTL 40 + 70 @ 51.89.
//
// Every cashbook amount is re-derived (qty x rate + BRK + FED) before it is
// written, and the script REFUSES to write unless they all agree.
//
//   MONGODB_URI=... DRY_RUN=1 node import-bma-cashbook-20260922.mjs
//   MONGODB_URI=... node import-bma-cashbook-20260922.mjs
import mongoose from "mongoose";

const USER_ID = "6a368e470160489b1b496fd1";
const r2 = (v) => Math.round(v * 100 + 1e-9) / 100;
const day = (s) => new Date(`${s}T00:00:00.000Z`);
const dry = process.env.DRY_RUN === "1";

// Today's fills: brokerage from the cashbook, SST estimated (FED prints .00 until the note).
const TODAY = "2026-09-22";
const TODAY_BUYS = [
  { voucher: "54546247", symbol: "MEBL", qty: 69, rate: 552.2, brk: 57.15, cashbook: 38158.95 },
  { voucher: "54546389", symbol: "MUREB", qty: 120, rate: 933.0, brk: 167.94, cashbook: 112127.94 },
  { voucher: "54546408", symbol: "MEBL", qty: 25, rate: 552.2, brk: 20.71, cashbook: 13825.71 },
  { voucher: "54546473", symbol: "MEBL", qty: 2, rate: 552.2, brk: 1.66, cashbook: 1106.06 },
  { voucher: "54546502", symbol: "MEBL", qty: 9, rate: 552.2, brk: 7.45, cashbook: 4977.25 },
  { voucher: "54546571", symbol: "MEBL", qty: 37, rate: 552.2, brk: 30.65, cashbook: 20462.05 },
  { voucher: "54546582", symbol: "MEBL", qty: 8, rate: 552.2, brk: 6.63, cashbook: 4424.23 },
  { voucher: "54546735", symbol: "MUREB", qty: 5, rate: 933.0, brk: 7.0, cashbook: 4672.0 },
];
const UNBILLED_TOTAL = 199754.19;

// 9 Sep: the typed rows and the cashbook's fills (FED is the SST, billed on the note).
const TYPED_9SEP = [
  { symbol: "AHCL", shares: 45, pricePerShare: 15.72 },
  { symbol: "PTL", shares: 110, pricePerShare: 51.97 },
];
const FILLS_9SEP = [
  { voucher: "54284223", symbol: "PTL", qty: 40, rate: 51.89, brk: 3.11, fed: 0.47, cashbook: 2079.18 },
  { voucher: "54284309", symbol: "PTL", qty: 70, rate: 51.89, brk: 5.45, fed: 0.82, cashbook: 3638.57 },
  { voucher: "54284342", symbol: "AHCL", qty: 1, rate: 15.69, brk: 0.03, fed: 0.01, cashbook: 15.73 },
  { voucher: "54284371", symbol: "AHCL", qty: 44, rate: 15.69, brk: 1.32, fed: 0.2, cashbook: 691.88 },
];

const CASH = [
  { date: "2026-09-01", type: "DEPOSIT", amount: 828.04, notes: "Reconciliation to BMA's cashbook: opening balance 828.04 CR on 1 Sep 2026" },
  { date: "2026-09-04", type: "WITHDRAWAL", amount: 1.0, notes: "Custody charges for August 2026 (BMA bill 2105676)" },
  { date: "2026-09-07", type: "DEPOSIT", amount: 15000, notes: "CDC raast payment (BMA voucher GBR0204941)" },
  { date: "2026-09-09", type: "DEPOSIT", amount: 2000, notes: "CDC raast payment (BMA voucher GBR0205917)" },
  { date: "2026-09-11", type: "DEPOSIT", amount: 21000, notes: "CDC raast payment (BMA voucher GBR0206938)" },
  { date: "2026-09-14", type: "DEPOSIT", amount: 35500, notes: "CDC raast payment (BMA voucher GBR0207690)" },
  { date: "2026-09-21", type: "DEPOSIT", amount: 200000, notes: "CDC raast payment (BMA voucher GBR0209508)" },
  { date: "2026-09-22", type: "DEPOSIT", amount: 200000, notes: "CDC raast payment (BMA voucher GBR0209759)" },
];
const REDEMPTION_DEPOSIT_NOTE = /^Redemption of /;
const BMA_BALANCE_TODAY = 490.06;

const EXPECTED_BEFORE = { MEBL: 415, MUREB: 466, AHCL: 20954, PTL: 1373 };

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

// --- re-derive every cashbook amount before touching anything ----------------
let broken = 0;
const check = (label, got, want) => {
  const ok = Math.abs(got - want) < 0.005;
  if (!ok) broken++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label.padEnd(28)} ${got.toFixed(2).padStart(11)} vs ${want.toFixed(2).padStart(11)}`);
};
console.log("today's fills (cashbook amount = qty x rate + BRK, FED .00 until the note):");
for (const f of TODAY_BUYS) {
  const derivedBrk = r2(Math.max(f.qty * f.rate * 0.0015, f.qty * 0.03));
  check(`${f.symbol} ${f.qty} brokerage`, derivedBrk, f.brk);
  check(`${f.symbol} ${f.qty} amount`, r2(f.qty * f.rate + f.brk), f.cashbook);
}
check("unbilled total", r2(TODAY_BUYS.reduce((s, f) => s + f.cashbook, 0)), UNBILLED_TOTAL);
console.log("9 Sep fills (amount = qty x rate + BRK + FED):");
for (const f of FILLS_9SEP) check(`${f.symbol} ${f.qty} amount`, r2(f.qty * f.rate + f.brk + f.fed), f.cashbook);
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

for (const f of TODAY_BUYS) {
  const dupe = await txCol.findOne({ userId: USER_ID, symbol: f.symbol, type: "BUY", date: day(TODAY), shares: f.qty, pricePerShare: f.rate, deletedAt: null });
  if (dupe) await fail(`BUY ${f.symbol} ${f.qty} @ ${f.rate} on ${TODAY} already exists (_id ${dupe._id}).`);
}
const typed = [];
for (const t of TYPED_9SEP) {
  const found = await txCol.find({ userId: USER_ID, symbol: t.symbol, type: "BUY", date: day("2026-09-09"), shares: t.shares, pricePerShare: t.pricePerShare, deletedAt: null }).toArray();
  if (found.length !== 1) await fail(`expected one typed BUY ${t.symbol} ${t.shares} @ ${t.pricePerShare} on 9 Sep 2026, found ${found.length}.`);
  typed.push(found[0]);
  console.log(`typed 9 Sep row: BUY ${t.symbol} ${t.shares} @ ${t.pricePerShare}, fees ${found[0].fees}, net ${found[0].netAmount} (_id ${found[0]._id})`);
}
const redemptionDeposits = await cashCol.find({ userId: USER_ID, type: "DEPOSIT", date: day("2026-09-21"), notes: REDEMPTION_DEPOSIT_NOTE }).toArray();
if (redemptionDeposits.length !== 2) await fail(`expected the two redemption deposits of 21 Sep, found ${redemptionDeposits.length}.`);
for (const c of CASH) {
  const dupe = await cashCol.findOne({ userId: USER_ID, type: c.type, date: day(c.date), amount: c.amount });
  if (dupe) await fail(`a ${c.type} of ${c.amount} on ${c.date} already exists (_id ${dupe._id}).`);
}
const before = {};
for (const symbol of Object.keys(EXPECTED_BEFORE)) {
  before[symbol] = derive(await txCol.find({ userId: USER_ID, symbol, deletedAt: null }).sort({ date: 1, createdAt: 1 }).toArray());
  if (Math.abs(before[symbol].shares - EXPECTED_BEFORE[symbol]) > 1e-6) await fail(`the ledger holds ${before[symbol].shares} ${symbol}, expected ${EXPECTED_BEFORE[symbol]}.`);
  console.log(`before: ${symbol.padEnd(5)} ${String(before[symbol].shares).padStart(6)} shares, avg ${before[symbol].avgCost.toFixed(2)}`);
}

// Rows to write.
const todayRows = TODAY_BUYS.map((f) => {
  const sst = r2(f.brk * 0.15);
  return { ...f, sst, fees: r2(f.brk + sst), gross: r2(f.qty * f.rate), net: r2(f.qty * f.rate + f.brk + sst), notes: `BMA cashbook 22 Sep 2026, trade ${f.voucher}: brokerage ${f.brk.toFixed(2)} exact, SST estimated at 15%; the contract note replaces these figures` };
});
const sepRows = FILLS_9SEP.map((f) => ({ ...f, sst: f.fed, fees: r2(f.brk + f.fed), gross: r2(f.qty * f.rate), net: f.cashbook, notes: `BMA cashbook 22 Sep 2026, trade ${f.voucher} (market rate, brokerage ${f.brk.toFixed(2)} + SST ${f.fed.toFixed(2)})` }));
console.log("\nwould write:");
for (const r of todayRows) console.log(`  BUY ${r.symbol.padEnd(5)} ${String(r.qty).padStart(4)} @ ${r.rate} on ${TODAY}: brokerage ${r.brk.toFixed(2)}, SST est ${r.sst.toFixed(2)}, net ${r.net.toFixed(2)}`);
for (const r of sepRows) console.log(`  BUY ${r.symbol.padEnd(5)} ${String(r.qty).padStart(4)} @ ${r.rate} on 2026-09-09: brokerage ${r.brk.toFixed(2)}, SST ${r.sst.toFixed(2)}, net ${r.net.toFixed(2)} (replacing the typed rows)`);
for (const c of CASH) console.log(`  ${c.type.padEnd(10)} ${c.amount.toFixed(2).padStart(10)} on ${c.date}: ${c.notes}`);
console.log(`  remove the redemption deposits of 21 Sep (${redemptionDeposits.map((d) => d.amount.toFixed(2)).join(" + ")})`);
console.log(`  today's SST estimate in all: ${todayRows.reduce((s, r) => s + r.sst, 0).toFixed(2)}`);

if (dry) {
  console.log("\n[DRY RUN] nothing written.");
  await mongoose.disconnect();
  process.exit(0);
}

const now = new Date();
await txCol.deleteMany({ _id: { $in: typed.map((t) => t._id) } });
await cashCol.deleteMany({ _id: { $in: redemptionDeposits.map((d) => d._id) } });
const insertTrade = async (r, date, i) =>
  txCol.insertOne({
    userId: USER_ID, portfolioId, symbol: r.symbol, type: "BUY", date: day(date), shares: r.qty, pricePerShare: r.rate,
    totalAmount: r.gross, fees: r.fees, netAmount: r.net, notes: r.notes,
    ratio: "", taxDeducted: 0, zakatDeducted: 0, financialYear: "", dividendType: "", source: "import", deletedAt: null,
    createdAt: new Date(now.getTime() + i), updatedAt: now, __v: 0,
  });
for (const [i, r] of sepRows.entries()) await insertTrade(r, "2026-09-09", i);
for (const [i, r] of todayRows.entries()) await insertTrade(r, TODAY, 10 + i);
for (const c of CASH) await cashCol.insertOne({ userId: USER_ID, portfolioId, date: day(c.date), type: c.type, amount: c.amount, notes: c.notes, createdAt: now, updatedAt: now, __v: 0 });
console.log("\nwritten.");
for (const symbol of Object.keys(EXPECTED_BEFORE)) {
  const d = derive(await txCol.find({ userId: USER_ID, symbol, deletedAt: null }).sort({ date: 1, createdAt: 1 }).toArray());
  await hCol.updateOne({ userId: USER_ID, symbol }, { $set: { currentShares: d.shares, avgCostBasis: d.avgCost, totalCost: d.totalCost, realizedPL: d.realizedPL, totalDividendsReceived: d.dividendsReceived, updatedAt: now } });
  console.log(`after:  ${symbol.padEnd(5)} ${String(d.shares).padStart(6)} shares, avg ${d.avgCost.toFixed(2)}, cost ${d.totalCost.toFixed(2)}`);
}

// The September walk, the app's way (credits before debits on a day), against BMA's cashbook.
const sepTx = await txCol.find({ userId: USER_ID, deletedAt: null, date: { $gte: day("2026-09-01") }, type: { $in: ["BUY", "SELL", "DIVIDEND"] } }).toArray();
const sepCash = await cashCol.find({ userId: USER_ID, date: { $gte: day("2026-09-01") } }).toArray();
const walk = (withDividends) => {
  const ev = [];
  for (const c of sepCash) ev.push({ t: c.date.getTime(), credit: c.type === "DEPOSIT", d: c.type === "DEPOSIT" ? c.amount : -c.amount });
  for (const t of sepTx) {
    if (t.type === "DIVIDEND" && !withDividends) continue;
    ev.push({ t: t.date.getTime(), credit: t.type !== "BUY", d: t.type === "BUY" ? -t.netAmount : t.netAmount });
  }
  ev.sort((a, b) => a.t - b.t || Number(b.credit) - Number(a.credit));
  return ev.reduce((s, e) => s + e.d, 0);
};
console.log(`\nSeptember walk without dividends: ${walk(false).toFixed(2)} (BMA cashbook today ${BMA_BALANCE_TODAY.toFixed(2)}; the gap is the SST on today's fills the note will bill, ${todayRows.reduce((s, r) => s + r.sst, 0).toFixed(2)})`);
console.log(`September walk with dividends:    ${walk(true).toFixed(2)} (dividends are paid to the bank, not to BMA)`);
await mongoose.disconnect();
