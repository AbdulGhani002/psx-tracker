// Bring the MCB funds up to the statement of 19 August 2026.
//
// The statement covers 19-AUG only, so the ~Rs 4k redemption the owner made a
// few days earlier has no row of its own. It is still PROVABLE: the statement
// prints the closing balance for 18-AUG, and the difference between that and
// the units the app last recorded is exactly the redemption.
//
//   app last recorded (06-AUG)   536.4755 units
//   statement last balance 18-AUG 498.0149 units
//   ------------------------------------------------
//   redeemed                      38.4606 units
//
// Then on 19-AUG a Rs 35,000 online investment bought 336.3438 units at
// 104.0602, taking the balance to 834.3587.
//
// Cost basis follows the same convention as the iSave reconciler: a redemption
// takes cost out at the running average and leaves the average untouched; new
// money adds its cost and re-blends the average.
//
// Every figure the statement prints is checked before anything is written —
// the unit chain, the units bought against the rate, and the closing value. If
// any of them disagree the script stops rather than writing a number the
// statement does not support.
//
//   MONGODB_URI=... DRY_RUN=1 node scripts/update-mcb-20260819.mjs
//   MONGODB_URI=... node scripts/update-mcb-20260819.mjs
//
import mongoose from "mongoose";

const USER_ID = "6a368e470160489b1b496fd1";
const STATEMENT_DATE = "2026-08-19";

// --- exactly what the statement prints --------------------------------------
const CMO = {
  fund: "MCB Cash Management Optimizer",
  lastBalanceUnits: 498.0149, // closing 18-AUG-26
  investedRs: 35000,
  investedRate: 104.0602,
  investedUnits: 336.3438,
  closingUnits: 834.3587,
  repurchasePrice: 104.0602,
  closingValue: 86823.53,
};
const ALHDDF = { fund: "Alhamra Daily Dividend Fund", closingUnits: 0.1378, price: 100, closingValue: 13.78 };
// Present on the statement but not tracked in the app — noted, not invented.
const UNTRACKED = [
  { fund: "MCB Pakistan Stock Market Fund", units: 0.0044, value: 1.67 },
  { fund: "MCB Pakistan Sovereign Fund", units: 0.0903, value: 5.05 },
];
const STATEMENT_TOTAL = 86844.03;

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
    problems.push(`closing value: ${CMO.closingUnits} x ${CMO.repurchasePrice} != ${CMO.closingValue}`);
  }
  if (!close(ALHDDF.closingUnits * ALHDDF.price, ALHDDF.closingValue, 0.01)) {
    problems.push(`ALHDDF value mismatch`);
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
  console.log("Statement reconciles with itself: unit chain, units bought, and closing values all agree.\n");

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

  // --- derive the redemption from the unit balances -------------------------
  const redeemedUnits = r2((cmo.units - CMO.lastBalanceUnits) * 10000) / 10000;
  const startCost = cmo.units * cmo.avgCost;
  const costOut = redeemedUnits * cmo.avgCost; // redemption leaves the average alone
  const costAfterRedemption = startCost - costOut;
  const newCost = costAfterRedemption + CMO.investedRs;
  const newAvg = newCost / CMO.closingUnits;

  if (redeemedUnits < 0) {
    console.error(
      `REFUSING — the app holds ${cmo.units} units but the statement's 18-AUG balance is higher (${CMO.lastBalanceUnits}). That is a purchase this script does not model; check the statement.`
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log("MCB Cash Management Optimizer");
  console.log(`  app last recorded (${cmo.anchorDate})   ${cmo.units.toFixed(4).padStart(10)} units @ avg ${cmo.avgCost.toFixed(6)}`);
  console.log(`  statement last balance 18-AUG      ${CMO.lastBalanceUnits.toFixed(4).padStart(10)} units`);
  console.log(`  => redeemed before the statement   ${redeemedUnits.toFixed(4).padStart(10)} units  (cost out Rs ${r2(costOut).toFixed(2)}, the "around 4k")`);
  console.log(`  19-AUG online investment           ${CMO.investedUnits.toFixed(4).padStart(10)} units  (Rs ${CMO.investedRs} @ ${CMO.investedRate})`);
  console.log(`  => closing balance                 ${CMO.closingUnits.toFixed(4).padStart(10)} units @ avg ${newAvg.toFixed(6)}`);
  console.log(`  value at repurchase ${CMO.repurchasePrice}          Rs ${CMO.closingValue.toFixed(2)}`);
  console.log(`  cost ${r2(startCost).toFixed(2)} - ${r2(costOut).toFixed(2)} + ${CMO.investedRs} = ${r2(newCost).toFixed(2)}`);
  console.log(`  unrealised ${(CMO.closingValue - newCost >= 0 ? "+" : "")}${r2(CMO.closingValue - newCost).toFixed(2)}`);

  const alh = await col.findOne({ userId: USER_ID, mufapName: ALHDDF.fund });
  if (alh) {
    const same = close(alh.units, ALHDDF.closingUnits, 0.0001);
    console.log(
      `\nAlhamra Daily Dividend Fund: app ${alh.units} units, statement ${ALHDDF.closingUnits} — ${same ? "unchanged, nothing to do" : "DIFFERS, left alone for you to check"}`
    );
  }

  console.log("\nOn the statement but not tracked in the app (dust, left as-is):");
  for (const u of UNTRACKED) console.log(`  ${u.fund}: ${u.units} units, Rs ${u.value.toFixed(2)}`);
  console.log(
    `  statement total Rs ${STATEMENT_TOTAL.toFixed(2)}; the app will show Rs ${r2(CMO.closingValue + ALHDDF.closingValue).toFixed(2)}, the Rs ${r2(UNTRACKED.reduce((s, u) => s + u.value, 0)).toFixed(2)} difference being those two.`
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
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("update failed:", err);
  process.exit(1);
});
