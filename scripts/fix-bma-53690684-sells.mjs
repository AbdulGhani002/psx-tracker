// Correct the two MEBL SELL rows of BMA sale note 53690684, 17 August 2026.
//
// They were entered from memory rather than from the note. Row 1 carried
// 588.80 — the NET rate, with commission already inside it — recorded against
// zero fees, so the commission was double-counted into the price and the SST
// was missing entirely. Row 2 carried 589.82, which appears on no line of the
// note (market 589.71, net 588.8254). Together the proceeds read Rs 159.65
// high, which inflates the realised gain on MEBL and the CGT with it.
//
// Rewritten on the house convention: market rate as the price, commission plus
// a proportional share of the note-level SST as fees, and for a SALE
// netAmount = qty * market rate - fees.
//
// Gates before it writes:
//   1. Each row must still look exactly as it did when the discrepancy was
//      found — if anything changed in between, stop rather than clobber it.
//   2. Each row must reproduce the note's own Amount Receivable.
//   3. The two netAmounts must sum to the note's grand total, 294,342.35.
//   4. Already-corrected rows are detected and skipped, so re-running is safe.
//
//   MONGODB_URI=... DRY_RUN=1 node scripts/fix-bma-53690684-sells.mjs
//   MONGODB_URI=... node scripts/fix-bma-53690684-sells.mjs
//
import mongoose from "mongoose";

const USER_ID = "6a368e470160489b1b496fd1";
const NOTE = "53690684";
const TRADE_DATE = new Date("2026-08-17T00:00:00.000Z");
const NOTE_SST = 66.35;
const NOTE_SUBTOTAL = 294408.7;
const NOTE_GRAND_TOTAL = 294342.35;

const ROWS = [
  {
    id: "6a82b6942c6edc185456da53",
    qty: 400,
    rate: 589.7,
    commPerShare: 0.8846,
    noteReceivable: 235526.16,
    expectPrice: 588.8, // what is wrongly stored today
  },
  {
    id: "6a82b6ba2c6edc185456da7a",
    qty: 100,
    rate: 589.71,
    commPerShare: 0.8846,
    noteReceivable: 58882.54,
    expectPrice: 589.82,
  },
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
  const rows = ROWS.map((r) => ({
    ...r,
    totalAmount: r2(r.qty * r.rate),
    commission: r2(r.qty * r.commPerShare),
  }));
  // SST split in proportion to commission, largest remainder so the paisa land
  // on the printed figure rather than drifting.
  const totalComm = rows.reduce((s, r) => s + r.commission, 0);
  const target = paisa(NOTE_SST);
  const exact = rows.map((r) => (target * r.commission) / totalComm);
  const floors = exact.map(Math.floor);
  const short = target - floors.reduce((s, v) => s + v, 0);
  const order = exact.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
  const sst = [...floors];
  for (let k = 0; k < short; k++) sst[order[k % order.length].i] += 1;

  rows.forEach((r, i) => {
    r.sst = sst[i] / 100;
    r.fees = r2(r.commission + r.sst);
    // A SALE pays out the market value LESS the frictions.
    r.netAmount = r2(r.totalAmount - r.fees);
  });
  return rows;
}

function verify(rows) {
  const problems = [];
  for (const r of rows) {
    const receivable = r2(r.totalAmount - r.commission);
    if (paisa(receivable) !== paisa(r.noteReceivable)) {
      problems.push(`${r.qty} sh: computed receivable ${receivable} != note ${r.noteReceivable}`);
    }
  }
  const sumNet = rows.reduce((s, r) => s + paisa(r.netAmount), 0);
  if (sumNet !== paisa(NOTE_GRAND_TOTAL)) {
    problems.push(`netAmounts sum to ${sumNet / 100}, note grand total is ${NOTE_GRAND_TOTAL}`);
  }
  const sumRecv = rows.reduce((s, r) => s + paisa(r.noteReceivable), 0);
  if (sumRecv !== paisa(NOTE_SUBTOTAL)) {
    problems.push(`note rows sum to ${sumRecv / 100}, note subtotal is ${NOTE_SUBTOTAL}`);
  }
  const sumSst = rows.reduce((s, r) => s + paisa(r.sst), 0);
  if (sumSst !== paisa(NOTE_SST)) {
    problems.push(`SST allocation sums to ${sumSst / 100}, note SST is ${NOTE_SST}`);
  }
  return problems;
}

const run = async () => {
  const rows = build();
  console.log(`BMA sale note ${NOTE} — ${TRADE_DATE.toISOString().slice(0, 10)}\n`);
  console.log("  qty   market rate     comm     SST     fees        total          net");
  for (const r of rows) {
    console.log(
      `${String(r.qty).padStart(5)}  ${r.rate.toFixed(4).padStart(11)} ${r.commission.toFixed(2).padStart(8)} ${r.sst
        .toFixed(2)
        .padStart(7)} ${r.fees.toFixed(2).padStart(8)} ${r.totalAmount.toFixed(2).padStart(12)} ${r.netAmount
        .toFixed(2)
        .padStart(12)}`
    );
  }
  const sum = rows.reduce((s, r) => s + r.netAmount, 0);
  console.log(`\nproceeds ${r2(sum)} (note grand total ${NOTE_GRAND_TOTAL})`);

  const problems = verify(rows);
  if (problems.length > 0) {
    console.error("\nREFUSING TO WRITE — does not reconcile to the note:");
    for (const p of problems) console.error("  " + p);
    process.exit(1);
  }
  console.log("reconciles to the note exactly.\n");

  await mongoose.connect(uri);
  const col = mongoose.connection.collection("transactions");
  const { ObjectId } = mongoose.mongo;

  const plan = [];
  for (const r of rows) {
    const doc = await col.findOne({ _id: new ObjectId(r.id) });
    if (!doc) {
      console.error(`REFUSING — row ${r.id} not found.`);
      await mongoose.disconnect();
      process.exit(1);
    }
    if (String(doc.userId) !== USER_ID || doc.symbol !== "MEBL" || doc.type !== "SELL" || doc.shares !== -r.qty) {
      console.error(`REFUSING — row ${r.id} is not the MEBL SELL of ${r.qty} it was.`);
      await mongoose.disconnect();
      process.exit(1);
    }
    if (paisa(doc.pricePerShare) === paisa(r.rate) && paisa(doc.netAmount) === paisa(r.netAmount)) {
      console.log(`  ${r.qty} sh: already corrected, skipping.`);
      continue;
    }
    if (paisa(doc.pricePerShare) !== paisa(r.expectPrice)) {
      console.error(
        `REFUSING — row ${r.id} price is ${doc.pricePerShare}, expected the known-bad ${r.expectPrice}. It changed since this was diagnosed; re-check before overwriting.`
      );
      await mongoose.disconnect();
      process.exit(1);
    }
    plan.push({ r, before: { price: doc.pricePerShare, fees: doc.fees, total: doc.totalAmount, net: doc.netAmount } });
  }

  if (plan.length === 0) {
    console.log("Nothing to do — both rows already match the note.");
    await mongoose.disconnect();
    return;
  }

  console.log("changes:");
  for (const p of plan) {
    console.log(
      `  ${p.r.qty} sh  price ${p.before.price} -> ${p.r.rate} | fees ${p.before.fees} -> ${p.r.fees} | net ${p.before.net.toFixed(
        2
      )} -> ${p.r.netAmount.toFixed(2)}`
    );
  }
  const deltaNet = plan.reduce((s, p) => s + (p.r.netAmount - p.before.net), 0);
  console.log(`  recorded proceeds change: ${r2(deltaNet)}`);

  if (dry) {
    console.log("\n[DRY RUN] nothing written.");
    await mongoose.disconnect();
    return;
  }

  for (const p of plan) {
    await col.updateOne(
      { _id: new ObjectId(p.r.id) },
      {
        $set: {
          pricePerShare: p.r.rate,
          totalAmount: p.r.totalAmount,
          fees: p.r.fees,
          netAmount: p.r.netAmount,
          notes: `BMA note ${NOTE} (comm+SST); corrected from the contract note`,
          updatedAt: new Date(),
        },
      }
    );
  }
  console.log(`\nupdated ${plan.length} row${plan.length === 1 ? "" : "s"}.`);

  const after = await col
    .find({ userId: USER_ID, symbol: "MEBL", type: "SELL", date: TRADE_DATE, deletedAt: null })
    .toArray();
  const total = after.reduce((s, t) => s + t.netAmount, 0);
  console.log(`MEBL sale proceeds now ${r2(total)} against the note's ${NOTE_GRAND_TOTAL}.`);
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("correction failed:", err);
  process.exit(1);
});
