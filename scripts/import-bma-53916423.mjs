// BMA purchase confirmation 53916423 — HINOON 5 @ 982.98, traded 25 Aug 2026,
// settling 27 Aug 2026. Adds to an existing position.
//
// The note prints every number needed to check itself, so nothing here is
// taken on trust. BMA's convention is 0.15% commission plus 15% SST on that
// commission; the script derives both and REFUSES to write unless each one
// matches what the note itself prints:
//
//   qty x market rate  5 x 982.98        = 4,914.90
//   commission         4,914.90 x 0.0015 =     7.37   (note: 1.4740/share x 5)
//   SST                7.37 x 0.15       =     1.11   (note: S.S.T 1.11)
//   fees               7.37 + 1.11       =     8.48
//   net                4,914.90 + 8.48   = 4,923.38   (note: GRAND TOTAL)
//
// pricePerShare is the MARKET rate, never the 984.4540 net rate — the net rate
// already has commission inside it, and storing it would count the commission
// twice once fees are added on top.
//
//   MONGODB_URI=... DRY_RUN=1 node scripts/import-bma-53916423.mjs
//   MONGODB_URI=... node scripts/import-bma-53916423.mjs
//
import mongoose from "mongoose";

const USER_ID = "6a368e470160489b1b496fd1";
const TRADE_DATE = new Date("2026-08-25T00:00:00.000Z");
const NOTE = "53916423";
const COMMISSION_RATE = 0.0015;
const SST_RATE = 0.15;

const SYMBOL = "HINOON";
const QTY = 5;
const MARKET_RATE = 982.98;

// What the note prints. These are the control, not the output.
const NOTE_COMM_PER_SHARE = 1.474;
const NOTE_NET_RATE = 984.454;
const NOTE_AMOUNT = 4922.27; // qty x net rate
const NOTE_SST = 1.11;
const NOTE_GRAND_TOTAL = 4923.38;

const r2 = (v) => Math.round(v * 100) / 100;
const paisa = (v) => Math.round(v * 100);

const uri = process.env.MONGODB_URI;
const dry = process.env.DRY_RUN === "1";
if (!uri) {
  console.error("MONGODB_URI is required.");
  process.exit(1);
}

const run = async () => {
  const totalAmount = r2(QTY * MARKET_RATE);
  const commission = r2(totalAmount * COMMISSION_RATE);
  const sst = r2(commission * SST_RATE);
  const fees = r2(commission + sst);
  const netAmount = r2(totalAmount + fees);

  console.log(`BMA note ${NOTE} — ${SYMBOL} ${QTY} @ ${MARKET_RATE} (market), traded 25 Aug 2026\n`);
  const checks = [
    ["commission", commission, r2(NOTE_COMM_PER_SHARE * QTY), "note comm/share x qty"],
    ["SST", sst, NOTE_SST, "note S.S.T line"],
    ["qty x net rate", r2(QTY * NOTE_NET_RATE), NOTE_AMOUNT, "note Amount Payable"],
    ["net amount", netAmount, NOTE_GRAND_TOTAL, "note GRAND TOTAL"],
  ];
  let broken = 0;
  for (const [label, got, want, source] of checks) {
    const ok = paisa(got) === paisa(want);
    if (!ok) broken++;
    console.log(
      `  ${ok ? "ok  " : "FAIL"} ${label.padEnd(15)} computed ${got.toFixed(2).padStart(9)} vs ${want
        .toFixed(2)
        .padStart(9)}  (${source})`
    );
  }
  if (broken > 0) {
    console.error(`\nREFUSING TO WRITE — ${broken} figure(s) do not match the note. Not guessing the fees.`);
    process.exit(1);
  }
  console.log("\n  every figure reconciles to the note to the paisa.\n");

  await mongoose.connect(uri);
  const txCol = mongoose.connection.collection("transactions");
  const hCol = mongoose.connection.collection("holdings");

  const dupe = await txCol.findOne({
    userId: USER_ID,
    symbol: SYMBOL,
    type: "BUY",
    date: TRADE_DATE,
    shares: QTY,
    deletedAt: null,
  });
  if (dupe) {
    console.error(`REFUSING TO WRITE — ${SYMBOL} ${QTY} on 25 Aug 2026 already exists (_id ${dupe._id}).`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const holding = await hCol.findOne({ userId: USER_ID, symbol: SYMBOL });
  if (!holding) {
    console.error(`REFUSING TO WRITE — no ${SYMBOL} holding record. This note adds to an existing position.`);
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`before: ${SYMBOL} ${holding.currentShares} shares, avg cost ${Number(holding.avgCostBasis).toFixed(2)}`);

  if (dry) {
    console.log(`\n[DRY RUN] would insert 1 BUY row: ${QTY} @ ${MARKET_RATE}, fees ${fees}, net ${netAmount}.`);
    await mongoose.disconnect();
    return;
  }

  const now = new Date();
  await txCol.insertOne({
    userId: USER_ID,
    symbol: SYMBOL,
    type: "BUY",
    date: TRADE_DATE,
    shares: QTY,
    pricePerShare: MARKET_RATE,
    totalAmount,
    fees,
    netAmount,
    notes: `BMA purchase confirmation ${NOTE} (market rate, comm 0.15% + SST)`,
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
  console.log(`inserted BUY ${SYMBOL} ${QTY} @ ${MARKET_RATE}, net ${netAmount}.`);

  // Recompute the stored holding from the ledger — average cost, same walk the
  // app's deriveFromTransactions() does. These fields are never hand-written.
  const txs = await txCol
    .find({ userId: USER_ID, symbol: SYMBOL, deletedAt: null })
    .sort({ date: 1, createdAt: 1 })
    .toArray();
  let shares = 0, totalCost = 0, realizedPL = 0, dividendsReceived = 0;
  for (const t of txs.sort((a, b) => new Date(a.date) - new Date(b.date))) {
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
    { userId: USER_ID, symbol: SYMBOL },
    {
      $set: {
        currentShares: shares,
        avgCostBasis: avgCost,
        totalCost,
        realizedPL,
        totalDividendsReceived: dividendsReceived,
        updatedAt: now,
      },
    }
  );
  console.log(`after:  ${SYMBOL} ${shares} shares, avg cost ${avgCost.toFixed(2)}, total cost ${totalCost.toFixed(2)}`);

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("import failed:", err);
  process.exit(1);
});
