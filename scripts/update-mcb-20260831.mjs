// Bring the MCB funds up to the statement of 31 August 2026.
//
// This one is clean. The statement's opening balance for 30-AUG is 834.3587
// units, which is exactly what the app already holds, so unlike the 19-AUG
// statement there is no hidden redemption to derive. One transaction:
//
//   opening 30-AUG                834.3587 units
//   31-AUG online investment      143.6622 units  (Rs 15,000 @ 104.4116)
//   ------------------------------------------------
//   closing                       978.0209 units
//
// Cost basis convention is unchanged from the earlier reconcilers: new money
// adds its cost and re-blends the average.
//
// Every figure the statement prints is checked before anything is written: the
// unit chain, the units bought against the rate, each closing value, and the
// printed grand total. If any of them disagree the script stops rather than
// writing a number the statement does not support.
//
//   MONGODB_URI=... DRY_RUN=1 node scripts/update-mcb-20260831.mjs
//   MONGODB_URI=... node scripts/update-mcb-20260831.mjs
//
import mongoose from "mongoose";

const USER_ID = "6a368e470160489b1b496fd1";
const STATEMENT_DATE = "2026-08-31";

// --- exactly what the statement prints --------------------------------------
const CMO = {
  fund: "MCB Cash Management Optimizer",
  lastBalanceUnits: 834.3587, // closing 30-AUG-26
  investedRs: 15000,
  investedRate: 104.4116,
  investedUnits: 143.6622,
  closingUnits: 978.0209,
  repurchasePrice: 104.4116, // as on 31 AUG 2026
  closingValue: 102116.72,
};
const ALHDDF = {
  fund: "Alhamra Daily Dividend Fund",
  closingUnits: 0.1378,
  price: 100, // as on 31 AUG 2026
  closingValue: 13.78,
};
// Present on the statement but not tracked in the app — noted, not invented.
const UNTRACKED = [
  { fund: "MCB Pakistan Stock Market Fund", units: 0.0044, price: 378.3629, value: 1.67 },
  { fund: "MCB Pakistan Sovereign Fund", units: 0.0903, price: 56.08, value: 5.07 },
];
const STATEMENT_TOTAL = 102137.24;

const r2 = (v) => Math.round(v * 100) / 100;
const close = (a, b, tol) => Math.abs(a - b) <= tol;

const uri = process.env.MONGODB_URI;
const dry = process.env.DRY_RUN === "1";
if (!uri) {
  console.error("MONGODB_URI is required.");
  process.exit(1);
}

const run = async () => {
  // --- the statement must agree with itself before we trust it --------------
  const problems = [];
  if (!close(CMO.lastBalanceUnits + CMO.investedUnits, CMO.closingUnits, 0.0001)) {
    problems.push(`unit chain: ${CMO.lastBalanceUnits} + ${CMO.investedUnits} != ${CMO.closingUnits}`);
  }
  if (!close(CMO.investedRs / CMO.investedRate, CMO.investedUnits, 0.0005)) {
    problems.push(`units bought: ${CMO.investedRs} / ${CMO.investedRate} != ${CMO.investedUnits}`);
  }
  if (!close(CMO.closingUnits * CMO.repurchasePrice, CMO.closingValue, 0.02)) {
    problems.push(`CMO closing value: ${CMO.closingUnits} x ${CMO.repurchasePrice} != ${CMO.closingValue}`);
  }
  if (!close(ALHDDF.closingUnits * ALHDDF.price, ALHDDF.closingValue, 0.01)) {
    problems.push(`ALHDDF value mismatch`);
  }
  for (const u of UNTRACKED) {
    if (!close(u.units * u.price, u.value, 0.02)) problems.push(`${u.fund} value mismatch`);
  }
  const sumAll = CMO.closingValue + ALHDDF.closingValue + UNTRACKED.reduce((s, u) => s + u.value, 0);
  if (!close(sumAll, STATEMENT_TOTAL, 0.02)) {
    problems.push(`fund values sum to ${r2(sumAll)}, statement total is ${STATEMENT_TOTAL}`);
  }
  if (problems.length > 0) {
    console.error("REFUSING — the statement does not reconcile with itself:");
    for (const p of problems) console.error("  " + p);
    process.exit(1);
  }
  console.log("Statement reconciles with itself: unit chain, units bought, every closing value, and the printed total all agree.\n");

  await mongoose.connect(uri);
  const col = mongoose.connection.collection("mutualfunds");

  const cmo = await col.findOne({ userId: USER_ID, mufapName: CMO.fund });
  if (!cmo) {
    console.error(`REFUSING — no ${CMO.fund} record found.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  if (close(cmo.units, CMO.closingUnits, 0.0001)) {
    console.log("MCBCMO already at the statement balance — nothing to do.");
    await mongoose.disconnect();
    return;
  }

  // --- the app must be sitting exactly on the statement's opening ----------
  // If it is not, something happened between statements that this script does
  // not model, and guessing would corrupt the cost basis.
  if (!close(cmo.units, CMO.lastBalanceUnits, 0.0001)) {
    const delta = r2((cmo.units - CMO.lastBalanceUnits) * 10000) / 10000;
    console.error(
      `REFUSING — the app holds ${cmo.units} units but the statement's 30-AUG opening is ${CMO.lastBalanceUnits} (difference ${delta}).\n` +
        `  There is activity between the two that this statement does not show. Reconcile that first.`
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  const startCost = cmo.units * cmo.avgCost;
  const newCost = startCost + CMO.investedRs;
  const newAvg = newCost / CMO.closingUnits;
  const unrealised = CMO.closingValue - newCost;

  console.log("MCB Cash Management Optimizer");
  console.log(`  app / statement opening 30-AUG     ${cmo.units.toFixed(4).padStart(10)} units @ avg ${cmo.avgCost.toFixed(6)}  (agree)`);
  console.log(`  31-AUG online investment           ${CMO.investedUnits.toFixed(4).padStart(10)} units  (Rs ${CMO.investedRs.toLocaleString()} @ ${CMO.investedRate})`);
  console.log(`  => closing balance                 ${CMO.closingUnits.toFixed(4).padStart(10)} units @ avg ${newAvg.toFixed(6)}`);
  console.log(`  value at repurchase ${CMO.repurchasePrice}          Rs ${CMO.closingValue.toLocaleString()}`);
  console.log(`  cost ${r2(startCost).toFixed(2)} + ${CMO.investedRs} = ${r2(newCost).toFixed(2)}`);
  console.log(`  unrealised ${unrealised >= 0 ? "+" : ""}Rs ${r2(unrealised).toFixed(2)}  (${((unrealised / newCost) * 100).toFixed(2)}% on cost)`);

  const alh = await col.findOne({ userId: USER_ID, mufapName: ALHDDF.fund });
  if (alh) {
    const same = close(alh.units, ALHDDF.closingUnits, 0.0001);
    console.log(
      `\nAlhamra Daily Dividend Fund: app ${alh.units} units, statement ${ALHDDF.closingUnits} — ${same ? "unchanged, nothing to do" : "DIFFERS, left alone for you to check"}`
    );
  }

  console.log("\nOn the statement but not tracked in the app (dust, left as-is):");
  for (const u of UNTRACKED) console.log(`  ${u.fund}: ${u.units} units, Rs ${u.value.toFixed(2)}`);
  const tracked = r2(CMO.closingValue + ALHDDF.closingValue);
  console.log(
    `  statement total Rs ${STATEMENT_TOTAL.toLocaleString()}; the app will show Rs ${tracked.toLocaleString()}, the Rs ${r2(STATEMENT_TOTAL - tracked).toFixed(2)} difference being those two.`
  );

  if (dry) {
    console.log("\n[DRY RUN] nothing written.");
    await mongoose.disconnect();
    return;
  }

  await col.updateOne(
    { _id: cmo._id },
    {
      $set: {
        units: CMO.closingUnits,
        avgCost: newAvg,
        anchorDate: STATEMENT_DATE,
        updatedAt: new Date(),
      },
    }
  );
  console.log(`\nupdated ${CMO.fund}: ${CMO.closingUnits} units @ avg ${newAvg.toFixed(6)}, anchored ${STATEMENT_DATE}.`);

  // The Alhamra anchor is what its daily accrual counts from. The statement
  // confirms the balance is still 0.1378 on 31-AUG, so move the anchor forward
  // rather than letting the app accrue from a date the statement has since
  // superseded.
  if (alh && close(alh.units, ALHDDF.closingUnits, 0.0001) && alh.anchorDate < STATEMENT_DATE) {
    await col.updateOne(
      { _id: alh._id },
      { $set: { anchorDate: STATEMENT_DATE, updatedAt: new Date() } }
    );
    console.log(`re-anchored ${ALHDDF.fund} to ${STATEMENT_DATE} (balance confirmed unchanged at ${ALHDDF.closingUnits} units).`);
  }

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("update failed:", err);
  process.exit(1);
});
