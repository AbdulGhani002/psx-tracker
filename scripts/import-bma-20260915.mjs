// BMA contract notes of 15 Sep 2026, settling 16 Sep 2026 (T+1):
//   purchase confirmation 54420363: AHCL 100 @ 14.99, MARI 2 @ 646.88,
//     MARI 53 @ 646.90, MARI 16 @ 646.76, MARI 11 @ 646.89, MEBL 242 @ 550.00,
//     PTL 300 @ 48.50; TOTAL 202,496.46, S.S.T 45.63, GRAND TOTAL 202,542.09
//   sale confirmation 54419955: INDU 26 @ 1,815.00, INDU 2 @ 1,815.10,
//     LUCK 6 @ 410.79, LUCK 5 @ 410.79, LUCK 359 @ 410.79;
//     TOTAL 202,508.27, S.S.T 45.64, WHT 0, GRAND TOTAL 202,462.63
//
// Abdul had typed these trades into the app himself on the day, as one row a
// name: the net rate as the price with a fee estimate on top (so the
// commission counted about twice), LUCK sold as 376 where the note says 370.
// This script removes those six rows and writes the note's twelve lines in
// their place, at the market rate with the note's own commission and its
// share of the SST. LUCK keeps 6 shares on the ledger afterwards: the note
// sold 370 and the ledger, built from earlier notes, held 376.
//
// Every figure the notes print is re-derived and the script REFUSES to write
// unless they reconcile. BMA charges 0.15% of the market rate with a floor of
// 3 paisa a share, prints the per-share commission to four decimals (to the
// paisa on a one- or two-share line), then 15% SST on the commission. On
// these two notes the printed SST is one to two paisa above 15% of the
// summed commission (45.63 vs 45.61, 45.64 vs 45.63); the printed figure
// governs, checked to within five paisa, and is spread over the lines in
// proportion to their commission so the nets sum to the GRAND TOTAL.
//
//   MONGODB_URI=... DRY_RUN=1 node import-bma-20260915.mjs
//   MONGODB_URI=... node import-bma-20260915.mjs
//
import mongoose from "mongoose";

const USER_ID = "6a368e470160489b1b496fd1";
const TRADE_DATE = new Date("2026-09-15T00:00:00.000Z");
const COMMISSION_RATE = 0.0015;
const COMMISSION_FLOOR = 0.03;
const SST_RATE = 0.15;

const NOTES = [
  {
    note: "54420363",
    side: "BUY",
    lines: [
      { symbol: "AHCL", qty: 100, marketRate: 14.99, noteCommPerShare: 0.03, noteNetRate: 15.02, noteAmount: 1502.0 },
      { symbol: "MARI", qty: 2, marketRate: 646.88, noteCommPerShare: 0.97, noteNetRate: 647.85, noteAmount: 1295.7 },
      { symbol: "MARI", qty: 53, marketRate: 646.9, noteCommPerShare: 0.9704, noteNetRate: 647.8704, noteAmount: 34337.13 },
      { symbol: "MARI", qty: 16, marketRate: 646.76, noteCommPerShare: 0.97, noteNetRate: 647.73, noteAmount: 10363.68 },
      { symbol: "MARI", qty: 11, marketRate: 646.89, noteCommPerShare: 0.97, noteNetRate: 647.86, noteAmount: 7126.46 },
      { symbol: "MEBL", qty: 242, marketRate: 550.0, noteCommPerShare: 0.825, noteNetRate: 550.825, noteAmount: 133299.65 },
      { symbol: "PTL", qty: 300, marketRate: 48.5, noteCommPerShare: 0.0728, noteNetRate: 48.5728, noteAmount: 14571.84 },
    ],
    noteTotal: 202496.46,
    noteSst: 45.63,
    noteGrandTotal: 202542.09,
  },
  {
    note: "54419955",
    side: "SELL",
    lines: [
      { symbol: "INDU", qty: 26, marketRate: 1815.0, noteCommPerShare: 2.7227, noteNetRate: 1812.2773, noteAmount: 47119.21 },
      { symbol: "INDU", qty: 2, marketRate: 1815.1, noteCommPerShare: 2.725, noteNetRate: 1812.375, noteAmount: 3624.75 },
      { symbol: "LUCK", qty: 6, marketRate: 410.79, noteCommPerShare: 0.615, noteNetRate: 410.175, noteAmount: 2461.05 },
      { symbol: "LUCK", qty: 5, marketRate: 410.79, noteCommPerShare: 0.616, noteNetRate: 410.174, noteAmount: 2050.87 },
      { symbol: "LUCK", qty: 359, marketRate: 410.79, noteCommPerShare: 0.6162, noteNetRate: 410.1738, noteAmount: 147252.39 },
    ],
    noteTotal: 202508.27,
    noteSst: 45.64,
    noteGrandTotal: 202462.63,
  },
];

// The rows Abdul typed on the day, matched exactly before they are removed.
const TYPED_ROWS = [
  { symbol: "LUCK", type: "SELL", shares: -376, pricePerShare: 410.17 },
  { symbol: "INDU", type: "SELL", shares: -28, pricePerShare: 1812 },
  { symbol: "AHCL", type: "BUY", shares: 100, pricePerShare: 14.99 },
  { symbol: "MARI", type: "BUY", shares: 82, pricePerShare: 647.84 },
  { symbol: "MEBL", type: "BUY", shares: 242, pricePerShare: 550.42 },
  { symbol: "PTL", type: "BUY", shares: 300, pricePerShare: 48.57 },
];

// What the ledger must hold once the typed rows are gone, from the notes
// imported before this one.
const EXPECTED_BEFORE = { AHCL: 20834, MARI: 134, MEBL: 173, PTL: 1067, INDU: 28, LUCK: 376 };

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
    console.error(`REFUSING TO WRITE: ${broken} figure(s) do not match the notes.`);
    process.exit(1);
  }
  console.log("every figure reconciles to the notes.\n");

  await mongoose.connect(uri);
  const txCol = mongoose.connection.collection("transactions");
  const hCol = mongoose.connection.collection("holdings");
  const portfolio = await mongoose.connection.collection("portfolios").findOne({ userId: USER_ID, isDefault: true });
  const portfolioId = portfolio ? String(portfolio._id) : "";

  // The typed rows must all be there, exactly as expected, and none of the
  // note's lines may be there already.
  const typed = [];
  for (const t of TYPED_ROWS) {
    const found = await txCol.find({ userId: USER_ID, symbol: t.symbol, type: t.type, date: TRADE_DATE, shares: t.shares, pricePerShare: t.pricePerShare, deletedAt: null }).toArray();
    if (found.length !== 1) return fail(`expected exactly one typed ${t.type} ${t.symbol} ${t.shares} @ ${t.pricePerShare} dated 15 Sep 2026, found ${found.length}.`);
    typed.push(found[0]);
    console.log(`typed row: ${t.type.padEnd(4)} ${t.symbol.padEnd(4)} ${String(t.shares).padStart(5)} @ ${t.pricePerShare}, fees ${found[0].fees}, net ${found[0].netAmount} (_id ${found[0]._id})`);
  }
  const others = await txCol.find({ userId: USER_ID, date: TRADE_DATE, deletedAt: null, _id: { $nin: typed.map((t) => t._id) } }).toArray();
  if (others.length > 0) return fail(`${others.length} other row(s) dated 15 Sep 2026 exist: ${others.map((o) => `${o.type} ${o.symbol} ${o.shares} @ ${o.pricePerShare}`).join(", ")}.`);

  // The ledger without the typed rows must be where the earlier notes left it.
  const before = {};
  for (const symbol of Object.keys(EXPECTED_BEFORE)) {
    const txs = await txCol.find({ userId: USER_ID, symbol, deletedAt: null, _id: { $nin: typed.map((t) => t._id) } }).sort({ date: 1, createdAt: 1 }).toArray();
    before[symbol] = derive(txs);
    if (Math.abs(before[symbol].shares - EXPECTED_BEFORE[symbol]) > 1e-6) return fail(`without the typed rows the ledger holds ${before[symbol].shares} ${symbol}, expected ${EXPECTED_BEFORE[symbol]}.`);
    console.log(`before: ${symbol.padEnd(4)} ${String(before[symbol].shares).padStart(6)} shares, avg cost ${before[symbol].avgCost.toFixed(2)}, cost ${before[symbol].totalCost.toFixed(2)}`);
  }
  console.log();

  if (dry) {
    console.log(`[DRY RUN] would delete the ${typed.length} typed rows and insert:`);
    for (const row of all) console.log(`  ${row.side.padEnd(4)} ${row.symbol.padEnd(4)} ${String(row.qty).padStart(4)} @ ${row.marketRate}, commission ${row.commission.toFixed(2)}, SST ${row.sst.toFixed(2)}, fees ${row.fees.toFixed(2)}, net ${row.netAmount.toFixed(2)} (note ${row.note})`);
    console.log(`  LUCK would keep ${EXPECTED_BEFORE.LUCK - 370} shares: the note sold 370 of the ledger's 376.`);
    await mongoose.disconnect();
    return;
  }

  const del = await txCol.deleteMany({ _id: { $in: typed.map((t) => t._id) } });
  console.log(`deleted ${del.deletedCount} typed rows.`);

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
      createdAt: new Date(now.getTime() + i), // keeps the note's line order in the ledger
      updatedAt: now,
      __v: 0,
    });
    console.log(`inserted ${row.side} ${row.symbol} ${row.qty} @ ${row.marketRate}, fees ${row.fees.toFixed(2)}, net ${row.netAmount.toFixed(2)}.`);
  }
  for (const symbol of Object.keys(EXPECTED_BEFORE)) {
    const txs = await txCol.find({ userId: USER_ID, symbol, deletedAt: null }).sort({ date: 1, createdAt: 1 }).toArray();
    const d = derive(txs);
    await hCol.updateOne({ userId: USER_ID, symbol }, { $set: { currentShares: d.shares, avgCostBasis: d.avgCost, totalCost: d.totalCost, realizedPL: d.realizedPL, totalDividendsReceived: d.dividendsReceived, updatedAt: now } });
    console.log(`after:  ${symbol.padEnd(4)} ${String(d.shares).padStart(6)} shares, avg cost ${d.avgCost.toFixed(2)}, total cost ${d.totalCost.toFixed(2)}, realised to date ${d.realizedPL.toFixed(2)}`);
  }
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("import failed:", err);
  process.exit(1);
});
