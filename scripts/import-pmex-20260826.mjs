// Record the PMEX account from the MT5 back-office exports of 26 August 2026:
// the General Ledger (1–26 Aug) and the P/L report for account 200588420.
//
// What those documents prove: what the account is worth, what it deposited, and
// what each trading session made or lost after commission, fees and CGT.
//
// What they do NOT contain, anywhere: an entry price, an exit price, a lot
// count or a lot size. So no CommodityTrade row is written. PMEX's contract
// specs cannot be verified from a datacentre either, and a guessed lot size
// silently corrupts every figure derived from it — an empty contract table is
// honest, a fabricated one is not.
//
// The ledger is transcribed with the CLIENT's sign convention: positive
// increased the account. PMEX writes it from the broker's side, where the
// balance runs negative because the money is owed to you.
//
// Nothing is written unless opening + every movement lands exactly on the
// closing balance the statement prints.
//
//   MONGODB_URI=... DRY_RUN=1 node scripts/import-pmex-20260826.mjs
//   MONGODB_URI=... node scripts/import-pmex-20260826.mjs
//
import mongoose from "mongoose";

const USER_ID = "6a368e470160489b1b496fd1";
const ACCOUNT_NO = "200588420";
const OPENING_BALANCE = 316.25;
const OPENING_AS_OF = "2026-08-01";
const CLOSING_BALANCE = 24246.03;
const CLOSING_AS_OF = "2026-08-26";

const MOVEMENTS = [
  { date: "2026-08-15", kind: "PROFIT_DISTRIBUTION", amount: 2.14, description: "Profit distribution 01-JUL-26 to 31-JUL-26" },
  { date: "2026-08-19", kind: "DEPOSIT", amount: 25000, description: "MCB deposit 4105907" },
  { date: "2026-08-19", kind: "BANK_CHARGES", amount: -28.75, description: "MCB bank charges 4105907" },
  { date: "2026-08-20", kind: "FEES", amount: -4.13, description: "Exchange fees" },
  { date: "2026-08-20", kind: "UNREALISED_PL", amount: -224.86, description: "Mark to market, position held overnight" },
  { date: "2026-08-20", kind: "COMMISSION", amount: -16.16, description: "Commission" },
  { date: "2026-08-20", kind: "CGT_FEE", amount: -100, description: "CGT fee" },
  { date: "2026-08-21", kind: "FEES", amount: -4.13, description: "Exchange fees" },
  { date: "2026-08-21", kind: "REALISED_PL", amount: 552.42, description: "Realised P/L" },
  { date: "2026-08-21", kind: "COMMISSION", amount: -16.16, description: "Commission" },
  { date: "2026-08-21", kind: "CGT", amount: -16.38, description: "CGT" },
  { date: "2026-08-25", kind: "FEES", amount: -8.25, description: "Exchange fees" },
  { date: "2026-08-25", kind: "REALISED_PL", amount: 58.29, description: "Realised P/L" },
  { date: "2026-08-25", kind: "COMMISSION", amount: -32.32, description: "Commission" },
  { date: "2026-08-25", kind: "CGT", amount: -2.91, description: "CGT" },
  { date: "2026-08-26", kind: "FEES", amount: -49.51, description: "Exchange fees" },
  { date: "2026-08-26", kind: "REALISED_PL", amount: -854.88, description: "Realised P/L" },
  { date: "2026-08-26", kind: "COMMISSION", amount: -193.92, description: "Commission" },
  { date: "2026-08-26", kind: "CGT", amount: 19.29, description: "CGT refund" },
  { date: "2026-08-26", kind: "CGT_FEE", amount: -150, description: "CGT fee" },
];

// From the P/L report, one row per trading session.
const SESSIONS = [
  { date: "2026-08-20", contract: "CRUDE1-OC26", realised: 0, unrealised: -224.86 },
  { date: "2026-08-21", contract: "CRUDE1-OC26", realised: 552.42, unrealised: 0 },
  { date: "2026-08-25", contract: "CRUDE1-OC26", realised: 58.29, unrealised: 0 },
  { date: "2026-08-26", contract: "CRUDE1-OC26", realised: -854.88, unrealised: 0 },
];

const r2 = (v) => Math.round(v * 100) / 100;
const sumKind = (k) => r2(MOVEMENTS.filter((m) => m.kind === k).reduce((s, m) => s + m.amount, 0));

const uri = process.env.MONGODB_URI;
const dry = process.env.DRY_RUN === "1";
if (!uri) {
  console.error("MONGODB_URI is required.");
  process.exit(1);
}

const run = async () => {
  const moved = r2(MOVEMENTS.reduce((s, m) => s + m.amount, 0));
  const computed = r2(OPENING_BALANCE + moved);
  console.log(`PMEX account ${ACCOUNT_NO}, 1–26 August 2026\n`);
  console.log(`  opening ${OPENING_BALANCE.toFixed(2).padStart(12)}  (${OPENING_AS_OF})`);
  console.log(`  movements ${moved.toFixed(2).padStart(10)}  (${MOVEMENTS.length} rows)`);
  console.log(`  computed ${computed.toFixed(2).padStart(11)}`);
  console.log(`  statement ${CLOSING_BALANCE.toFixed(2).padStart(10)}  (${CLOSING_AS_OF})`);
  if (Math.abs(computed - CLOSING_BALANCE) >= 0.005) {
    console.error(`\nREFUSING TO WRITE — the ledger does not cross-foot (off by ${r2(computed - CLOSING_BALANCE)}).`);
    process.exit(1);
  }
  console.log("  => cross-foots exactly.\n");

  // The P/L report and the ledger must agree about what trading did.
  const sessionPl = r2(SESSIONS.reduce((s, x) => s + x.realised + x.unrealised, 0));
  const ledgerPl = r2(sumKind("REALISED_PL") + sumKind("UNREALISED_PL"));
  console.log(`  P/L report says ${sessionPl.toFixed(2)}, ledger says ${ledgerPl.toFixed(2)}`);
  if (Math.abs(sessionPl - ledgerPl) >= 0.005) {
    console.error("REFUSING TO WRITE — the P/L report and the general ledger disagree.");
    process.exit(1);
  }
  console.log("  => the two documents agree.\n");

  const costs = r2(-(sumKind("COMMISSION") + sumKind("FEES") + sumKind("CGT") + sumKind("CGT_FEE") + sumKind("BANK_CHARGES")));
  console.log(`  trading P/L ${ledgerPl.toFixed(2)}  (realised ${sumKind("REALISED_PL").toFixed(2)}, unrealised mark ${sumKind("UNREALISED_PL").toFixed(2)})`);
  console.log(`  costs       ${costs.toFixed(2)}  (commission ${(-sumKind("COMMISSION")).toFixed(2)}, fees ${(-sumKind("FEES")).toFixed(2)}, CGT ${(-sumKind("CGT")).toFixed(2)}, CGT fee ${(-sumKind("CGT_FEE")).toFixed(2)}, bank ${(-sumKind("BANK_CHARGES")).toFixed(2)})`);
  console.log(`  net         ${r2(ledgerPl - costs).toFixed(2)}\n`);
  console.log("  no CommodityTrade rows: these documents carry no entry, exit, lot count or lot size.\n");

  await mongoose.connect(uri);
  const col = mongoose.connection.collection("pmexaccounts");
  const existing = await col.findOne({ userId: USER_ID, accountNo: ACCOUNT_NO });
  console.log(existing ? `existing record found (as of ${existing.balanceAsOf}) — it will be replaced.` : "no existing record — creating.");

  if (dry) {
    console.log("\n[DRY RUN] nothing written.");
    await mongoose.disconnect();
    return;
  }

  const now = new Date();
  await col.updateOne(
    { userId: USER_ID, accountNo: ACCOUNT_NO },
    {
      $set: {
        userId: USER_ID,
        accountNo: ACCOUNT_NO,
        balance: CLOSING_BALANCE,
        balanceAsOf: CLOSING_AS_OF,
        openingBalance: OPENING_BALANCE,
        openingAsOf: OPENING_AS_OF,
        movements: MOVEMENTS,
        sessions: SESSIONS,
        statementFrom: OPENING_AS_OF,
        statementTo: CLOSING_AS_OF,
        notes: "MT5 back-office general ledger + P/L report, 26 Aug 2026. Session-level only; no per-contract detail published.",
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now, __v: 0 },
    },
    { upsert: true }
  );
  console.log(`\nrecorded PMEX account ${ACCOUNT_NO}: balance ${CLOSING_BALANCE.toFixed(2)} as of ${CLOSING_AS_OF}.`);
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("import failed:", err);
  process.exit(1);
});
