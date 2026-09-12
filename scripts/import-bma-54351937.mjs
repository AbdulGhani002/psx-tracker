// BMA purchase confirmation 54351937, traded 11 Sep 2026, settling 14 Sep
// 2026: AHCL 750 @ 14.50 and PTL 200 @ 48.00. Both add to existing positions.
//
// The note prints every number needed to check itself, so nothing here is
// taken on trust. BMA charges 0.15% commission with a floor of 3 paisa a
// share, plus 15% SST on the commission; the script derives every figure and
// REFUSES to write unless each one matches what the note prints:
//
//   AHCL  750 x 14.50 = 10,875.00   comm 0.15% = 0.0218/share, floored to 0.0300  -> 22.50
//   PTL   200 x 48.00 =  9,600.00   comm 0.15% = 0.0720/share                    -> 14.40
//   commission                                                                    36.90
//   SST 15%                                                                        5.54   (note: S.S.T 5.54)
//   amounts payable at the net rate: 10,897.50 + 9,614.40 = 20,511.90             (note: TOTAL)
//   grand total 20,511.90 + 5.54 = 20,517.44                                      (note: GRAND TOTAL)
//
// pricePerShare is the MARKET rate, never the net rate: the net rate already
// has the commission inside it, and storing it would count the commission
// twice once fees are added on top. Each line carries its own commission and
// its share of the SST.
//
//   MONGODB_URI=... DRY_RUN=1 node scripts/import-bma-54351937.mjs
//   MONGODB_URI=... node scripts/import-bma-54351937.mjs
//
import mongoose from "mongoose";

const USER_ID = "6a368e470160489b1b496fd1";
const TRADE_DATE = new Date("2026-09-11T00:00:00.000Z");
const NOTE = "54351937";
const COMMISSION_RATE = 0.0015;
const COMMISSION_FLOOR = 0.03; // per share
const SST_RATE = 0.15;

const LINES = [
  { symbol: "AHCL", qty: 750, marketRate: 14.5, noteCommPerShare: 0.03, noteNetRate: 14.53, noteAmount: 10897.5 },
  { symbol: "PTL", qty: 200, marketRate: 48.0, noteCommPerShare: 0.072, noteNetRate: 48.072, noteAmount: 9614.4 },
];
const NOTE_TOTAL = 20511.9;
const NOTE_SST = 5.54;
const NOTE_GRAND_TOTAL = 20517.44;

// Half-up to the paisa, the way the note rounds: 36.90 x 15% = 5.535 is 5.54,
// and plain Math.round sees 553.4999 and says 5.53.
const r2 = (v) => Math.round(v * 100 + 1e-9) / 100;
const r4 = (v) => Math.round(v * 10000 + 1e-9) / 10000;
const paisa = (v) => Math.round(v * 100);

const uri = process.env.MONGODB_URI;
const dry = process.env.DRY_RUN === "1";
if (!uri) {
  console.error("MONGODB_URI is required.");
  process.exit(1);
}

const run = async () => {
  console.log(`BMA note ${NOTE}, traded 11 Sep 2026, settling 14 Sep 2026\n`);
  const checks = [];
  let commissionTotal = 0, amountTotal = 0;
  const rows = LINES.map((l) => {
    const totalAmount = r2(l.qty * l.marketRate);
    const commPerShare = r4(Math.max(l.marketRate * COMMISSION_RATE, COMMISSION_FLOOR));
    const commission = r2(commPerShare * l.qty);
    commissionTotal += commission;
    amountTotal += r2(l.qty * l.noteNetRate);
    checks.push([`${l.symbol} comm/share`, commPerShare, l.noteCommPerShare, "note (+) Comm."]);
    checks.push([`${l.symbol} net rate`, r4(l.marketRate + commPerShare), l.noteNetRate, "note Net Rate"]);
    checks.push([`${l.symbol} amount`, r2(l.qty * l.noteNetRate), l.noteAmount, "note Amount Payable"]);
    return { ...l, totalAmount, commission };
  });
  const sst = r2(commissionTotal * SST_RATE);
  checks.push(["sum of amounts", r2(amountTotal), NOTE_TOTAL, "note TOTAL"]);
  checks.push(["SST", sst, NOTE_SST, "note S.S.T line"]);
  checks.push(["grand total", r2(amountTotal + sst), NOTE_GRAND_TOTAL, "note GRAND TOTAL"]);

  // The SST is split across the lines in proportion to their commission; the
  // rounded parts must add back to the printed SST.
  let sstAssigned = 0;
  for (const [i, row] of rows.entries()) {
    const share = i === rows.length - 1 ? r2(sst - sstAssigned) : r2(sst * (row.commission / commissionTotal));
    sstAssigned = r2(sstAssigned + share);
    row.sst = share;
    row.fees = r2(row.commission + share);
    row.netAmount = r2(row.totalAmount + row.fees);
  }
  checks.push(["sum of nets", r2(rows.reduce((s, r) => s + r.netAmount, 0)), NOTE_GRAND_TOTAL, "note GRAND TOTAL"]);

  let broken = 0;
  for (const [label, got, want, source] of checks) {
    const ok = paisa(got) === paisa(want);
    if (!ok) broken++;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${label.padEnd(16)} computed ${String(got).padStart(10)} vs ${String(want).padStart(10)}  (${source})`);
  }
  if (broken > 0) {
    console.error(`\nREFUSING TO WRITE: ${broken} figure(s) do not match the note. Not guessing the fees.`);
    process.exit(1);
  }
  console.log("\n  every figure reconciles to the note to the paisa.\n");

  await mongoose.connect(uri);
  const txCol = mongoose.connection.collection("transactions");
  const hCol = mongoose.connection.collection("holdings");

  for (const row of rows) {
    const dupe = await txCol.findOne({ userId: USER_ID, symbol: row.symbol, type: "BUY", date: TRADE_DATE, shares: row.qty, deletedAt: null });
    if (dupe) {
      console.error(`REFUSING TO WRITE: ${row.symbol} ${row.qty} on 11 Sep 2026 already exists (_id ${dupe._id}).`);
      await mongoose.disconnect();
      process.exit(1);
    }
    const holding = await hCol.findOne({ userId: USER_ID, symbol: row.symbol });
    if (!holding) {
      console.error(`REFUSING TO WRITE: no ${row.symbol} holding record. This note adds to existing positions.`);
      await mongoose.disconnect();
      process.exit(1);
    }
    console.log(`before: ${row.symbol} ${holding.currentShares} shares, avg cost ${Number(holding.avgCostBasis).toFixed(2)}`);
  }

  if (dry) {
    for (const row of rows) console.log(`\n[DRY RUN] would insert BUY ${row.symbol} ${row.qty} @ ${row.marketRate}, commission ${row.commission}, SST ${row.sst}, fees ${row.fees}, net ${row.netAmount}.`);
    await mongoose.disconnect();
    return;
  }

  const now = new Date();
  for (const row of rows) {
    await txCol.insertOne({
      userId: USER_ID,
      symbol: row.symbol,
      type: "BUY",
      date: TRADE_DATE,
      shares: row.qty,
      pricePerShare: row.marketRate,
      totalAmount: row.totalAmount,
      fees: row.fees,
      netAmount: row.netAmount,
      notes: `BMA purchase confirmation ${NOTE} (market rate, comm ${row.commission} + SST ${row.sst})`,
      ratio: "",
      taxDeducted: 0,
      zakatDeducted: 0,
      financialYear: "",
      dividendType: "",
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      __v: 0,
    });
    console.log(`inserted BUY ${row.symbol} ${row.qty} @ ${row.marketRate}, net ${row.netAmount}.`);

    // Recompute the stored holding from the ledger, the same walk the app's
    // deriveFromTransactions() does. These fields are never hand-written.
    const txs = await txCol.find({ userId: USER_ID, symbol: row.symbol, deletedAt: null }).sort({ date: 1, createdAt: 1 }).toArray();
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
      } else if (t.type === "DIVIDEND") {
        dividendsReceived += t.netAmount;
      } else if (t.type === "BONUS") {
        shares += t.shares;
      } else if (t.type === "SPLIT") {
        const [from, to] = String(t.ratio ?? "").split(":").map((x) => Number(String(x).trim()));
        if (from && to) shares *= to / from;
      }
    }
    const avgCost = shares > 0 ? totalCost / shares : 0;
    await hCol.updateOne(
      { userId: USER_ID, symbol: row.symbol },
      { $set: { currentShares: shares, avgCostBasis: avgCost, totalCost, realizedPL, totalDividendsReceived: dividendsReceived, updatedAt: now } }
    );
    console.log(`after:  ${row.symbol} ${shares} shares, avg cost ${avgCost.toFixed(2)}, total cost ${totalCost.toFixed(2)}`);
  }

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("import failed:", err);
  process.exit(1);
});
