// Import the BUY rows of BMA purchase note 53691360, trade date 17 Aug 2026.
//
// Transcribed from the contract note PDF, following the house convention:
//   pricePerShare = the MARKET rate from the note (never the net rate, which
//                   already has commission inside it)
//   fees          = this row's commission + its share of the note-level SST,
//                   allocated in proportion to commission
//   netAmount     = qty * market rate + fees
//
// Two gates before anything is written:
//   1. Each row must reproduce the note's own "Amount Payable" (qty * market
//      + commission) to the paisa.
//   2. The row netAmounts must sum EXACTLY to the note's grand total. If SST
//      allocation drifts by a single paisa the script refuses to insert.
//
//   MONGODB_URI=... DRY_RUN=1 node scripts/import-bma-53691360.mjs
//   MONGODB_URI=... node scripts/import-bma-53691360.mjs
//
import mongoose from "mongoose";

const USER_ID = "6a368e470160489b1b496fd1";
const NOTE = "53691360";
const TRADE_DATE = new Date("2026-08-17T00:00:00.000Z");
const NOTE_SST = 42.94;
const NOTE_SUBTOTAL = 191052.25;
const NOTE_GRAND_TOTAL = 191095.19;

// symbol, qty, market rate, commission per share, the note's own Amount Payable
const ROWS = [
  ["HINOON", 107, 1004.0, 1.506, 107589.14],
  ["INDU", 5, 1968.0, 2.952, 9854.76],
  ["LUCK", 40, 447.69, 0.6715, 17934.46],
  ["LUCK", 20, 447.65, 0.6715, 8966.43],
  ["MUREB", 9, 906.99, 1.36, 8175.15],
  ["MUREB", 41, 907.0, 1.3605, 37242.78],
  ["PTL", 24, 53.65, 0.0804, 1289.53],
];

const r2 = (v) => Math.round(v * 100) / 100;
const paisa = (v) => Math.round(v * 100);

const uri = process.env.MONGODB_URI;
const dry = process.env.DRY_RUN === "1";
if (!uri) {
  console.error("MONGODB_URI is required.");
  process.exit(1);
}

function build() {
  const rows = ROWS.map(([symbol, qty, rate, commPerShare, notePayable]) => {
    const totalAmount = r2(qty * rate);
    const commission = r2(qty * commPerShare);
    return { symbol, qty, rate, commission, totalAmount, notePayable };
  });

  // Allocate the note-level SST across rows in proportion to commission, using
  // largest-remainder so the paisa add up to the printed figure exactly rather
  // than drifting by a rounding crumb.
  const totalComm = rows.reduce((s, r) => s + r.commission, 0);
  const target = paisa(NOTE_SST);
  const exact = rows.map((r) => (target * r.commission) / totalComm);
  const floors = exact.map(Math.floor);
  let short = target - floors.reduce((s, v) => s + v, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  const sst = [...floors];
  for (let k = 0; k < short; k++) sst[order[k % order.length].i] += 1;

  rows.forEach((r, i) => {
    r.sst = sst[i] / 100;
    r.fees = r2(r.commission + r.sst);
    r.netAmount = r2(r.totalAmount + r.fees);
  });
  return rows;
}

function verify(rows) {
  const problems = [];
  for (const r of rows) {
    const payable = r2(r.totalAmount + r.commission);
    if (paisa(payable) !== paisa(r.notePayable)) {
      problems.push(`${r.symbol} ${r.qty}: computed payable ${payable} != note ${r.notePayable}`);
    }
  }
  const sumNet = rows.reduce((s, r) => s + paisa(r.netAmount), 0);
  if (sumNet !== paisa(NOTE_GRAND_TOTAL)) {
    problems.push(`netAmounts sum to ${sumNet / 100}, note grand total is ${NOTE_GRAND_TOTAL}`);
  }
  const sumSubtotal = rows.reduce((s, r) => s + paisa(r.notePayable), 0);
  if (sumSubtotal !== paisa(NOTE_SUBTOTAL)) {
    problems.push(`note rows sum to ${sumSubtotal / 100}, note subtotal is ${NOTE_SUBTOTAL}`);
  }
  const sumSst = rows.reduce((s, r) => s + paisa(r.sst), 0);
  if (sumSst !== paisa(NOTE_SST)) {
    problems.push(`SST allocation sums to ${sumSst / 100}, note SST is ${NOTE_SST}`);
  }
  return problems;
}

const run = async () => {
  const rows = build();

  console.log(`BMA note ${NOTE} — ${TRADE_DATE.toISOString().slice(0, 10)}\n`);
  console.log("symbol   qty  market rate     comm     SST     fees        total       net");
  for (const r of rows) {
    console.log(
      `${r.symbol.padEnd(7)} ${String(r.qty).padStart(4)}  ${r.rate.toFixed(4).padStart(11)} ${r.commission
        .toFixed(2)
        .padStart(8)} ${r.sst.toFixed(2).padStart(7)} ${r.fees.toFixed(2).padStart(8)} ${r.totalAmount
        .toFixed(2)
        .padStart(12)} ${r.netAmount.toFixed(2).padStart(11)}`
    );
  }
  const totals = rows.reduce(
    (a, r) => ({ comm: a.comm + r.commission, sst: a.sst + r.sst, net: a.net + r.netAmount }),
    { comm: 0, sst: 0, net: 0 }
  );
  console.log(
    `\ntotals: commission ${r2(totals.comm)}, SST ${r2(totals.sst)}, netAmount ${r2(totals.net)} (note grand total ${NOTE_GRAND_TOTAL})`
  );

  const problems = verify(rows);
  if (problems.length > 0) {
    console.error("\nREFUSING TO WRITE — the note does not reconcile:");
    for (const p of problems) console.error("  " + p);
    process.exit(1);
  }
  console.log("reconciles to the note exactly.\n");

  await mongoose.connect(uri);
  const col = mongoose.connection.collection("transactions");

  // Duplicate guard: same user, symbol, trade date, share count and a BUY.
  const dupes = [];
  for (const r of rows) {
    const existing = await col.findOne({
      userId: USER_ID,
      symbol: r.symbol,
      type: "BUY",
      date: TRADE_DATE,
      shares: r.qty,
      deletedAt: null,
    });
    if (existing) dupes.push(`${r.symbol} ${r.qty} (_id ${existing._id})`);
  }
  if (dupes.length > 0) {
    console.error("REFUSING TO WRITE — these rows already exist:");
    for (const d of dupes) console.error("  " + d);
    await mongoose.disconnect();
    process.exit(1);
  }

  const now = new Date();
  const docs = rows.map((r) => ({
    userId: USER_ID,
    symbol: r.symbol,
    type: "BUY",
    date: TRADE_DATE,
    shares: r.qty,
    pricePerShare: r.rate,
    totalAmount: r.totalAmount,
    fees: r.fees,
    netAmount: r.netAmount,
    notes: `BMA note ${NOTE} (comm+SST)`,
    ratio: "",
    taxDeducted: 0,
    zakatDeducted: 0,
    financialYear: "",
    dividendType: "",
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    __v: 0,
  }));

  if (dry) {
    console.log(`[DRY RUN] would insert ${docs.length} BUY rows. Nothing written.`);
    await mongoose.disconnect();
    return;
  }

  const res = await col.insertMany(docs);
  console.log(`inserted ${res.insertedCount} BUY rows.`);

  // Show the resulting position for each symbol touched, straight from the ledger.
  const symbols = [...new Set(rows.map((r) => r.symbol))];
  console.log("\nposition after (from all active transactions):");
  for (const sym of symbols) {
    const txs = await col.find({ userId: USER_ID, symbol: sym, deletedAt: null }).toArray();
    let shares = 0;
    for (const t of txs) {
      if (t.type === "BUY" || t.type === "RIGHT" || t.type === "BONUS") shares += t.shares;
      else if (t.type === "SELL") shares += t.shares; // already negative
    }
    console.log(`  ${sym.padEnd(7)} ${shares}`);
  }
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("import failed:", err);
  process.exit(1);
});
