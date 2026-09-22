// BMA contract note of 22 Sep 2026, settling 23 Sep 2026 (T+1):
//   purchase confirmation 54546247: AHCL 29 @ 15.05, MEBL 8 @ 552.20,
//     MEBL 62 @ 552.20, MEBL 69 @ 552.20, MEBL 2 @ 552.20, MEBL 9 @ 552.20,
//     MUREB 120 @ 933.00, MUREB 5 @ 933.00;
//     TOTAL 200,191.51, S.S.T 45.02, GRAND TOTAL 200,236.53
//
// Yesterday the day's fills came from BMA's cashbook, printed at 10:51 AM
// with the SST not yet billed and the AHCL trade not yet done. This replaces
// those eight rows with the note's own lines: the same 150 MEBL and 125 MUREB
// (the note groups the 25 and the 37 into one 62), plus the AHCL 29 the
// cashbook never saw, and the exact SST.
//
// Every figure the note prints is re-derived and the script REFUSES to write
// unless they reconcile. BMA charges 0.15% of the market rate with a floor of
// 3 paisa a share (AHCL at 15.05 pays the floor), then 15% SST on the summed
// commission; the printed SST governs and is checked to within five paisa.
//
//   MONGODB_URI=... DRY_RUN=1 node import-bma-20260922.mjs
//   MONGODB_URI=... node import-bma-20260922.mjs
//
import mongoose from "mongoose";

const USER_ID = "6a368e470160489b1b496fd1";
const TRADE_DATE = new Date("2026-09-22T00:00:00.000Z");
const COMMISSION_RATE = 0.0015;
const COMMISSION_FLOOR = 0.03;
const SST_RATE = 0.15;

const NOTES = [
  {
    note: "54546247",
    side: "BUY",
    lines: [
      { symbol: "AHCL", qty: 29, marketRate: 15.05, noteCommPerShare: 0.03, noteNetRate: 15.08, noteAmount: 437.32 },
      { symbol: "MEBL", qty: 8, marketRate: 552.2, noteCommPerShare: 0.8288, noteNetRate: 553.0288, noteAmount: 4424.23 },
      { symbol: "MEBL", qty: 62, marketRate: 552.2, noteCommPerShare: 0.8284, noteNetRate: 553.0284, noteAmount: 34287.76 },
      { symbol: "MEBL", qty: 69, marketRate: 552.2, noteCommPerShare: 0.8283, noteNetRate: 553.0283, noteAmount: 38158.95 },
      { symbol: "MEBL", qty: 2, marketRate: 552.2, noteCommPerShare: 0.83, noteNetRate: 553.03, noteAmount: 1106.06 },
      { symbol: "MEBL", qty: 9, marketRate: 552.2, noteCommPerShare: 0.8278, noteNetRate: 553.0278, noteAmount: 4977.25 },
      { symbol: "MUREB", qty: 120, marketRate: 933.0, noteCommPerShare: 1.3995, noteNetRate: 934.3995, noteAmount: 112127.94 },
      { symbol: "MUREB", qty: 5, marketRate: 933.0, noteCommPerShare: 1.4, noteNetRate: 934.4, noteAmount: 4672.0 },
    ],
    noteTotal: 200191.51,
    noteSst: 45.02,
    noteGrandTotal: 200236.53,
  },
];

// The cashbook rows written yesterday, matched exactly before they are removed.
const CASHBOOK_ROWS = [
  { symbol: "MEBL", shares: 69, pricePerShare: 552.2 },
  { symbol: "MEBL", shares: 25, pricePerShare: 552.2 },
  { symbol: "MEBL", shares: 2, pricePerShare: 552.2 },
  { symbol: "MEBL", shares: 9, pricePerShare: 552.2 },
  { symbol: "MEBL", shares: 37, pricePerShare: 552.2 },
  { symbol: "MEBL", shares: 8, pricePerShare: 552.2 },
  { symbol: "MUREB", shares: 120, pricePerShare: 933.0 },
  { symbol: "MUREB", shares: 5, pricePerShare: 933.0 },
];

// What the ledger must hold once those rows are gone.
const EXPECTED_BEFORE = { AHCL: 20954, MEBL: 415, MUREB: 466 };

const r2 = (v) => Math.round(v * 100 + 1e-9) / 100;
const r4 = (v) => Math.round(v * 10000 + 1e-9) / 10000;
const paisa = (v) => Math.round(v * 100);

const uri = process.env.MONGODB_URI;
const dry = process.env.DRY_RUN === "1";
if (!uri) {
  console.error("MONGODB_URI is required.");
  process.exit(1);
}

function reconcile(n) {
  const buy = n.side === "BUY";
  const checks = [];
  let commissionTotal = 0, amountTotal = 0;
  const rows = n.lines.map((l) => {
    const totalAmount = r2(l.qty * l.marketRate);
    const derivedComm = r4(Math.max(l.marketRate * COMMISSION_RATE, COMMISSION_FLOOR));
    const commission = r2(l.noteCommPerShare * l.qty);
    commissionTotal += commission;
    const lineAmount = r2(l.qty * l.noteNetRate);
    amountTotal += lineAmount;
    checks.push([`${l.symbol} ${l.qty} comm/share`, derivedComm, l.noteCommPerShare, "note Comm.", 0.005]);
    checks.push([`${l.symbol} ${l.qty} net rate`, r4(buy ? l.marketRate + l.noteCommPerShare : l.marketRate - l.noteCommPerShare), l.noteNetRate, "note Net Rate", 0]);
    checks.push([`${l.symbol} ${l.qty} amount`, lineAmount, l.noteAmount, buy ? "note Amount Payable" : "note Amount Receivable", 0.01]);
    return { ...l, totalAmount, commission };
  });
  commissionTotal = r2(commissionTotal);
  const sst = n.noteSst;
  checks.push(["sum of amounts", r2(amountTotal), n.noteTotal, "note TOTAL", 0.01]);
  checks.push(["15% of commission", r2(commissionTotal * SST_RATE), n.noteSst, "note S.S.T (printed figure governs)", 0.05]);
  checks.push(["grand total", r2(buy ? amountTotal + sst : amountTotal - sst), n.noteGrandTotal, "note GRAND TOTAL", 0.01]);

  let sstAssigned = 0;
  for (const [i, row] of rows.entries()) {
    const share = i === rows.length - 1 ? r2(sst - sstAssigned) : r2(sst * (row.commission / commissionTotal));
    sstAssigned = r2(sstAssigned + share);
    row.sst = share;
    row.fees = r2(row.commission + share);
    row.netAmount = r2(buy ? row.totalAmount + row.fees : row.totalAmount - row.fees);
  }
  checks.push(["sum of nets", r2(rows.reduce((s, r) => s + r.netAmount, 0)), n.noteGrandTotal, "note GRAND TOTAL", 0.01]);

  let broken = 0;
  console.log(`BMA ${buy ? "purchase" : "sale"} confirmation ${n.note}`);
  for (const [label, got, want, source, tol] of checks) {
    const ok = tol > 0 ? Math.abs(got - want) <= tol + 1e-9 : paisa(got) === paisa(want) || Math.abs(got - want) < 1e-9;
    if (!ok) broken++;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${label.padEnd(22)} computed ${String(got).padStart(10)} vs ${String(want).padStart(10)}  (${source})`);
  }
  return { rows, broken };
}

// The app's deriveFromTransactions(), walked here so the stored holding is
// rebuilt from the ledger and never hand-written.
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

const fail = async (msg) => {
  console.error(`REFUSING TO WRITE: ${msg}`);
  await mongoose.disconnect();
  process.exit(1);
};

const run = async () => {
  const all = [];
  let broken = 0;
  for (const n of NOTES) {
    const r = reconcile(n);
    broken += r.broken;
    all.push(...r.rows.map((row) => ({ ...row, side: n.side, note: n.note })));
    console.log();
  }
  if (broken > 0) {
    console.error(`REFUSING TO WRITE: ${broken} figure(s) do not match the note.`);
    process.exit(1);
  }
  console.log("every figure reconciles to the note.\n");

  await mongoose.connect(uri);
  const txCol = mongoose.connection.collection("transactions");
  const hCol = mongoose.connection.collection("holdings");
  const portfolio = await mongoose.connection.collection("portfolios").findOne({ userId: USER_ID, isDefault: true });
  const portfolioId = portfolio ? String(portfolio._id) : "";

  const old = [];
  for (const t of CASHBOOK_ROWS) {
    const found = await txCol.find({ userId: USER_ID, symbol: t.symbol, type: "BUY", date: TRADE_DATE, shares: t.shares, pricePerShare: t.pricePerShare, deletedAt: null }).toArray();
    if (found.length !== 1) return fail(`expected exactly one cashbook BUY ${t.symbol} ${t.shares} @ ${t.pricePerShare} dated 22 Sep 2026, found ${found.length}.`);
    old.push(found[0]);
  }
  console.log(`the ${old.length} rows written from the cashbook total ${r2(old.reduce((s, o) => s + o.netAmount, 0))}, against the note's ${NOTES[0].noteGrandTotal}`);
  const others = await txCol.find({ userId: USER_ID, date: TRADE_DATE, deletedAt: null, type: { $in: ["BUY", "SELL"] }, _id: { $nin: old.map((t) => t._id) } }).toArray();
  if (others.length > 0) return fail(`${others.length} other trade row(s) dated 22 Sep 2026 exist: ${others.map((o) => `${o.type} ${o.symbol} ${o.shares} @ ${o.pricePerShare}`).join(", ")}.`);

  for (const symbol of Object.keys(EXPECTED_BEFORE)) {
    const txs = await txCol.find({ userId: USER_ID, symbol, deletedAt: null, _id: { $nin: old.map((t) => t._id) } }).sort({ date: 1, createdAt: 1 }).toArray();
    const d = derive(txs);
    if (Math.abs(d.shares - EXPECTED_BEFORE[symbol]) > 1e-6) return fail(`without the cashbook rows the ledger holds ${d.shares} ${symbol}, expected ${EXPECTED_BEFORE[symbol]}.`);
    console.log(`before: ${symbol.padEnd(5)} ${String(d.shares).padStart(6)} shares, avg cost ${d.avgCost.toFixed(2)}, cost ${d.totalCost.toFixed(2)}`);
  }
  console.log();

  if (dry) {
    console.log(`[DRY RUN] would delete the ${old.length} cashbook rows and insert:`);
    for (const row of all) console.log(`  ${row.side.padEnd(4)} ${row.symbol.padEnd(5)} ${String(row.qty).padStart(4)} @ ${row.marketRate}, commission ${row.commission.toFixed(2)}, SST ${row.sst.toFixed(2)}, fees ${row.fees.toFixed(2)}, net ${row.netAmount.toFixed(2)} (note ${row.note})`);
    await mongoose.disconnect();
    return;
  }

  const del = await txCol.deleteMany({ _id: { $in: old.map((t) => t._id) } });
  console.log(`deleted ${del.deletedCount} cashbook rows.`);

  const now = new Date();
  for (const [i, row] of all.entries()) {
    await txCol.insertOne({
      userId: USER_ID,
      portfolioId,
      symbol: row.symbol,
      type: row.side,
      date: TRADE_DATE,
      shares: row.side === "SELL" ? -row.qty : row.qty,
      pricePerShare: row.marketRate,
      totalAmount: row.totalAmount,
      fees: row.fees,
      netAmount: row.netAmount,
      notes: `BMA ${row.side === "BUY" ? "purchase" : "sale"} confirmation ${row.note} (market rate, comm ${row.commission} + SST ${row.sst})`,
      ratio: "",
      taxDeducted: 0,
      zakatDeducted: 0,
      financialYear: "",
      dividendType: "",
      source: "import",
      deletedAt: null,
      createdAt: new Date(now.getTime() + i),
      updatedAt: now,
      __v: 0,
    });
    console.log(`inserted ${row.side} ${row.symbol} ${row.qty} @ ${row.marketRate}, fees ${row.fees.toFixed(2)}, net ${row.netAmount.toFixed(2)}.`);
  }
  for (const symbol of Object.keys(EXPECTED_BEFORE)) {
    const txs = await txCol.find({ userId: USER_ID, symbol, deletedAt: null }).sort({ date: 1, createdAt: 1 }).toArray();
    const d = derive(txs);
    await hCol.updateOne({ userId: USER_ID, symbol }, { $set: { currentShares: d.shares, avgCostBasis: d.avgCost, totalCost: d.totalCost, realizedPL: d.realizedPL, totalDividendsReceived: d.dividendsReceived, updatedAt: now } });
    console.log(`after:  ${symbol.padEnd(5)} ${String(d.shares).padStart(6)} shares, avg cost ${d.avgCost.toFixed(2)}, total cost ${d.totalCost.toFixed(2)}, realised to date ${d.realizedPL.toFixed(2)}`);
  }
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("import failed:", err);
  process.exit(1);
});
