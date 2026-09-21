// BMA contract note of 21 Sep 2026, settling 22 Sep 2026 (T+1):
//   purchase confirmation 54520629: MUREB 1 @ 934.99, MUREB 196 @ 937.00,
//     MUREB 2 @ 935.60, MUREB 1 @ 935.00, MUREB 13 @ 925.00, PTL 5 @ 50.70,
//     PTL 1 @ 50.70; TOTAL 200,021.98, S.S.T 44.94, GRAND TOTAL 200,066.92
//
// The 213 MUREB had been typed on the day from the broker app's all-in rate
// (937.64) as one row at 936.24; this replaces that row with the note's five
// lines and adds the 6 PTL the app had not shown.
//
// Every figure the note prints is re-derived and the script REFUSES to write
// unless they reconcile. BMA charges 0.15% of the market rate with a floor of
// 3 paisa a share, works the commission out per line to the paisa and prints
// it per share to four decimals (to the paisa on a one-share line), then 15%
// SST on the summed commission. Here the SST reconciles exactly.
//
//   MONGODB_URI=... DRY_RUN=1 node import-bma-20260921.mjs
//   MONGODB_URI=... node import-bma-20260921.mjs
//
import mongoose from "mongoose";

const USER_ID = "6a368e470160489b1b496fd1";
const TRADE_DATE = new Date("2026-09-21T00:00:00.000Z");
const COMMISSION_RATE = 0.0015;
const COMMISSION_FLOOR = 0.03;
const SST_RATE = 0.15;

const NOTES = [
  {
    note: "54520629",
    side: "BUY",
    lines: [
      { symbol: "MUREB", qty: 1, marketRate: 934.99, noteCommPerShare: 1.4, noteNetRate: 936.39, noteAmount: 936.39 },
      { symbol: "MUREB", qty: 196, marketRate: 937.0, noteCommPerShare: 1.4055, noteNetRate: 938.4055, noteAmount: 183927.48 },
      { symbol: "MUREB", qty: 2, marketRate: 935.6, noteCommPerShare: 1.405, noteNetRate: 937.005, noteAmount: 1874.01 },
      { symbol: "MUREB", qty: 1, marketRate: 935.0, noteCommPerShare: 1.4, noteNetRate: 936.4, noteAmount: 936.4 },
      { symbol: "MUREB", qty: 13, marketRate: 925.0, noteCommPerShare: 1.3877, noteNetRate: 926.3877, noteAmount: 12043.04 },
      { symbol: "PTL", qty: 5, marketRate: 50.7, noteCommPerShare: 0.076, noteNetRate: 50.776, noteAmount: 253.88 },
      { symbol: "PTL", qty: 1, marketRate: 50.7, noteCommPerShare: 0.08, noteNetRate: 50.78, noteAmount: 50.78 },
    ],
    noteTotal: 200021.98,
    noteSst: 44.94,
    noteGrandTotal: 200066.92,
  },
];

// The row typed on the day, matched exactly before it is removed.
const TYPED_ROWS = [{ symbol: "MUREB", type: "BUY", shares: 213, pricePerShare: 936.24 }];

// What the ledger must hold once the typed row is gone.
const EXPECTED_BEFORE = { MUREB: 253, PTL: 1367 };

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

  const typed = [];
  for (const t of TYPED_ROWS) {
    const found = await txCol.find({ userId: USER_ID, symbol: t.symbol, type: t.type, date: TRADE_DATE, shares: t.shares, pricePerShare: t.pricePerShare, deletedAt: null }).toArray();
    if (found.length !== 1) return fail(`expected exactly one typed ${t.type} ${t.symbol} ${t.shares} @ ${t.pricePerShare} dated 21 Sep 2026, found ${found.length}.`);
    typed.push(found[0]);
    console.log(`typed row: ${t.type.padEnd(4)} ${t.symbol.padEnd(5)} ${String(t.shares).padStart(5)} @ ${t.pricePerShare}, fees ${found[0].fees}, net ${found[0].netAmount} (_id ${found[0]._id})`);
  }
  const others = await txCol.find({ userId: USER_ID, date: TRADE_DATE, deletedAt: null, type: { $in: ["BUY", "SELL"] }, _id: { $nin: typed.map((t) => t._id) } }).toArray();
  if (others.length > 0) return fail(`${others.length} other trade row(s) dated 21 Sep 2026 exist: ${others.map((o) => `${o.type} ${o.symbol} ${o.shares} @ ${o.pricePerShare}`).join(", ")}.`);

  const before = {};
  for (const symbol of Object.keys(EXPECTED_BEFORE)) {
    const txs = await txCol.find({ userId: USER_ID, symbol, deletedAt: null, _id: { $nin: typed.map((t) => t._id) } }).sort({ date: 1, createdAt: 1 }).toArray();
    before[symbol] = derive(txs);
    if (Math.abs(before[symbol].shares - EXPECTED_BEFORE[symbol]) > 1e-6) return fail(`without the typed row the ledger holds ${before[symbol].shares} ${symbol}, expected ${EXPECTED_BEFORE[symbol]}.`);
    console.log(`before: ${symbol.padEnd(5)} ${String(before[symbol].shares).padStart(6)} shares, avg cost ${before[symbol].avgCost.toFixed(2)}, cost ${before[symbol].totalCost.toFixed(2)}`);
  }
  console.log();

  if (dry) {
    console.log(`[DRY RUN] would delete the ${typed.length} typed row and insert:`);
    for (const row of all) console.log(`  ${row.side.padEnd(4)} ${row.symbol.padEnd(5)} ${String(row.qty).padStart(4)} @ ${row.marketRate}, commission ${row.commission.toFixed(2)}, SST ${row.sst.toFixed(2)}, fees ${row.fees.toFixed(2)}, net ${row.netAmount.toFixed(2)} (note ${row.note})`);
    await mongoose.disconnect();
    return;
  }

  const del = await txCol.deleteMany({ _id: { $in: typed.map((t) => t._id) } });
  console.log(`deleted ${del.deletedCount} typed row.`);

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
