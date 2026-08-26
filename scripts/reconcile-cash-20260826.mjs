// Bring the derived brokerage cash balance down to the nil the account actually
// holds, as at 26 August 2026.
//
// The balance here is DERIVED — deposits plus sells plus dividends, minus buys
// and withdrawals — and this book was rebuilt from an NCCPL tax certificate,
// which carries every trade and no cash movements. Seven deposit rows from two
// weeks in 2026 stand against years of trading. The arithmetic had therefore
// drifted to Rs 365,438.90 against an account with nothing in it.
//
// Money genuinely did leave: Rs 25,000 to PMEX and Rs 35,000 into MCBCMO on 19
// August alone, plus transfers to the bank, none of which were ever written down
// as cash movements. So the missing side of the ledger is an outflow, and it is
// recorded as one — dated, labelled, and visible in the cash ledger rather than
// applied as a silent correction somewhere in the arithmetic.
//
// This is a RECONCILIATION, not a bank withdrawal. The note says so, because a
// future reader must not mistake it for one.
//
//   MONGODB_URI=... AMOUNT=365438.90 DRY_RUN=1 node scripts/reconcile-cash-20260826.mjs
//   MONGODB_URI=... AMOUNT=365438.90 node scripts/reconcile-cash-20260826.mjs
//
import mongoose from "mongoose";

const USER_ID = "6a368e470160489b1b496fd1";
const AS_OF = new Date("2026-08-26T00:00:00.000Z");
const NOTE =
  "Reconciliation to the actual brokerage balance of nil on 26 Aug 2026. " +
  "The cash ledger predates this book's rebuild from the NCCPL certificate and " +
  "does not carry every movement out of the account (Rs 25,000 to PMEX and " +
  "Rs 35,000 to MCBCMO on 19 Aug among them), so the derived balance had drifted " +
  "above what the account holds. Not a bank withdrawal.";

const uri = process.env.MONGODB_URI;
const dry = process.env.DRY_RUN === "1";
const amount = Number(process.env.AMOUNT);
if (!uri) {
  console.error("MONGODB_URI is required.");
  process.exit(1);
}
if (!Number.isFinite(amount) || amount <= 0) {
  console.error("AMOUNT must be the positive figure the derived balance currently stands at.");
  process.exit(1);
}

const run = async () => {
  await mongoose.connect(uri);
  const col = mongoose.connection.collection("cashentries");

  const already = await col.findOne({ userId: USER_ID, date: AS_OF, type: "WITHDRAWAL" });
  if (already) {
    console.error(`REFUSING — a reconciliation withdrawal already exists on this date (_id ${already._id}, Rs ${already.amount}).`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const entries = await col.find({ userId: USER_ID }).sort({ date: 1 }).toArray();
  console.log(`cash ledger currently holds ${entries.length} entries:`);
  for (const e of entries) {
    console.log(`  ${e.date.toISOString().slice(0, 10)}  ${e.type.padEnd(10)} ${Number(e.amount).toFixed(2).padStart(12)}`);
  }
  console.log(`\nrecording  2026-08-26  WITHDRAWAL ${amount.toFixed(2).padStart(12)}  (reconciliation to nil)\n`);

  if (dry) {
    console.log("[DRY RUN] nothing written.");
    await mongoose.disconnect();
    return;
  }

  const now = new Date();
  await col.insertOne({
    userId: USER_ID,
    date: AS_OF,
    type: "WITHDRAWAL",
    amount,
    notes: NOTE,
    createdAt: now,
    updatedAt: now,
    __v: 0,
  });
  console.log(`recorded. Re-derive the balance to confirm it now lands on zero.`);
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("reconcile failed:", err);
  process.exit(1);
});
