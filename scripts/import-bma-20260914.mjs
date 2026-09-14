// BMA contract notes of 14 Sep 2026, settling 15 Sep 2026 (T+1):
//   purchase confirmation 54387335: AHCL 900 @ 14.84, MARI 1 @ 649.49,
//     MEBL 20 @ 557.98, MEBL 35 @ 549.00
//   sale confirmation 54394011: PPL 40 @ 220.40
//
// Every figure the notes print is re-derived here and the script REFUSES to
// write unless all of them reconcile to the paisa. BMA charges 0.15% of the
// market rate with a floor of 3 paisa a share (AHCL at 14.84 pays 0.0300),
// then 15% SST on the commission. The per-share commission the note prints
// governs (BMA's fourth decimal is a hair under the arithmetic on MEBL 549.00
// and PPL 220.40); the derived figure is checked to within a ten-thousandth.
//
//   purchase: amounts payable at the net rate 13,383.00 + 650.46 + 11,176.34
//     + 19,243.82 = 44,453.62 (TOTAL), commission 73.529, SST 11.03,
//     GRAND TOTAL 44,464.65
//   sale: 40 x 220.40 = 8,816.00 gross, commission 13.22, amount receivable
//     8,802.78 (TOTAL), SST 1.98, GRAND TOTAL 8,800.80, WHT 0
//
// pricePerShare is the MARKET rate; fees carry the line's commission and its
// share of the SST; a buy's net is gross + fees, a sale's is gross - fees.
//
//   MONGODB_URI=... DRY_RUN=1 node import-bma-20260914.mjs
//   MONGODB_URI=... node import-bma-20260914.mjs
//
import mongoose from "mongoose";

const USER_ID = "6a368e470160489b1b496fd1";
const TRADE_DATE = new Date("2026-09-14T00:00:00.000Z");
const COMMISSION_RATE = 0.0015;
const COMMISSION_FLOOR = 0.03;
const SST_RATE = 0.15;

const NOTES = [
  {
    note: "54387335",
    side: "BUY",
    lines: [
      { symbol: "AHCL", qty: 900, marketRate: 14.84, noteCommPerShare: 0.03, noteNetRate: 14.87, noteAmount: 13383.0 },
      { symbol: "MARI", qty: 1, marketRate: 649.49, noteCommPerShare: 0.97, noteNetRate: 650.46, noteAmount: 650.46 },
      { symbol: "MEBL", qty: 20, marketRate: 557.98, noteCommPerShare: 0.837, noteNetRate: 558.817, noteAmount: 11176.34 },
      { symbol: "MEBL", qty: 35, marketRate: 549.0, noteCommPerShare: 0.8234, noteNetRate: 549.8234, noteAmount: 19243.82 },
    ],
    noteTotal: 44453.62,
    noteSst: 11.03,
    noteGrandTotal: 44464.65,
  },
  {
    note: "54394011",
    side: "SELL",
    lines: [{ symbol: "PPL", qty: 40, marketRate: 220.4, noteCommPerShare: 0.3305, noteNetRate: 220.0695, noteAmount: 8802.78 }],
    noteTotal: 8802.78,
    noteSst: 1.98,
    noteGrandTotal: 8800.8,
  },
];

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
    // BMA prints the per-share commission to four decimals, or to the paisa
    // on a one-share line (MARI 0.9742 prints as 0.97); the amounts below are
    // what must match exactly.
    checks.push([`${l.symbol} ${l.qty} comm/share`, derivedComm, l.noteCommPerShare, "note Comm.", 0.005]);
    checks.push([`${l.symbol} ${l.qty} net rate`, r4(buy ? l.marketRate + l.noteCommPerShare : l.marketRate - l.noteCommPerShare), l.noteNetRate, "note Net Rate", 0]);
    checks.push([`${l.symbol} ${l.qty} amount`, lineAmount, l.noteAmount, buy ? "note Amount Payable" : "note Amount Receivable", 0.01]);
    return { ...l, totalAmount, commission };
  });
  const sst = r2(commissionTotal * SST_RATE);
  checks.push(["sum of amounts", r2(amountTotal), n.noteTotal, "note TOTAL", 0.01]);
  checks.push(["SST", sst, n.noteSst, "note S.S.T", 0]);
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
  console.log("every figure reconciles to the notes to the paisa.\n");

  await mongoose.connect(uri);
  const txCol = mongoose.connection.collection("transactions");
  const hCol = mongoose.connection.collection("holdings");
  const portfolio = await mongoose.connection.collection("portfolios").findOne({ userId: USER_ID, isDefault: true });
  const portfolioId = portfolio ? String(portfolio._id) : "";

  for (const row of all) {
    const dupe = await txCol.findOne({ userId: USER_ID, symbol: row.symbol, type: row.side, date: TRADE_DATE, shares: row.side === "SELL" ? -row.qty : row.qty, pricePerShare: row.marketRate, deletedAt: null });
    if (dupe) {
      console.error(`REFUSING TO WRITE: ${row.side} ${row.symbol} ${row.qty} @ ${row.marketRate} on 14 Sep 2026 already exists (_id ${dupe._id}).`);
      await mongoose.disconnect();
      process.exit(1);
    }
    const holding = await hCol.findOne({ userId: USER_ID, symbol: row.symbol });
    if (!holding) {
      console.error(`REFUSING TO WRITE: no ${row.symbol} holding record.`);
      await mongoose.disconnect();
      process.exit(1);
    }
    if (row.side === "SELL" && Number(holding.currentShares) < row.qty) {
      console.error(`REFUSING TO WRITE: selling ${row.qty} ${row.symbol} but the ledger holds ${holding.currentShares}.`);
      await mongoose.disconnect();
      process.exit(1);
    }
    console.log(`before: ${row.symbol} ${holding.currentShares} shares, avg cost ${Number(holding.avgCostBasis).toFixed(2)}`);
  }

  if (dry) {
    for (const row of all) console.log(`\n[DRY RUN] would insert ${row.side} ${row.symbol} ${row.qty} @ ${row.marketRate}, commission ${row.commission}, SST ${row.sst}, fees ${row.fees}, net ${row.netAmount} (note ${row.note}).`);
    await mongoose.disconnect();
    return;
  }

  const now = new Date();
  for (const row of all) {
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
      createdAt: now,
      updatedAt: now,
      __v: 0,
    });
    console.log(`inserted ${row.side} ${row.symbol} ${row.qty} @ ${row.marketRate}, net ${row.netAmount}.`);
  }
  for (const symbol of new Set(all.map((r) => r.symbol))) {
    const txs = await txCol.find({ userId: USER_ID, symbol, deletedAt: null }).sort({ date: 1, createdAt: 1 }).toArray();
    const d = derive(txs);
    await hCol.updateOne({ userId: USER_ID, symbol }, { $set: { currentShares: d.shares, avgCostBasis: d.avgCost, totalCost: d.totalCost, realizedPL: d.realizedPL, totalDividendsReceived: d.dividendsReceived, updatedAt: now } });
    console.log(`after:  ${symbol} ${d.shares} shares, avg cost ${d.avgCost.toFixed(2)}, total cost ${d.totalCost.toFixed(2)}, realised ${d.realizedPL.toFixed(2)}`);
  }
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("import failed:", err);
  process.exit(1);
});
