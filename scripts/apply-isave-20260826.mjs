// Bring the MCB funds up to the iSave statement of 26 August 2026.
//
// The statement's closing figures are:
//
//   MCBCMO  834.3587 units @ 104.234 (25 AUG) = 86,968.54
//   MCBPSM     .0044 units @ 376.8492 (25 AUG) =      1.66   (dust, untracked)
//   MCBPSF     .0904 units @ 56.03    (25 AUG) =      5.07   (dust, untracked)
//   ALHDDF     .1378 units @ 100      (26 AUG) =     13.78
//                                     total    = 86,989.05
//
// and they sum to the statement's own printed total to the paisa, which is the
// check that matters — every figure is cross-footed before anything is written.
//
// The UNITS already match what the app holds: the 19 August update set MCBCMO
// to 834.3587 and nothing has moved since. So this changes no position. What it
// does is advance the anchor dates to the day the statement proves those unit
// counts, which for the daily-dividend fund also stops the app accruing units
// it has now been shown did not arrive.
//
// Cost basis is NOT touched. Units on a statement say nothing about what was
// paid for them.
//
//   MONGODB_URI=... DRY_RUN=1 node scripts/apply-isave-20260826.mjs
//   MONGODB_URI=... node scripts/apply-isave-20260826.mjs
//
import mongoose from "mongoose";

const USER_ID = "6a368e470160489b1b496fd1";

const TRACKED = [
  { mufapName: "MCB Cash Management Optimizer", code: "MCBCMO", units: 834.3587, nav: 104.234, value: 86968.54, asOf: "2026-08-25" },
  { mufapName: "Alhamra Daily Dividend Fund", code: "ALHDDF", units: 0.1378, nav: 100, value: 13.78, asOf: "2026-08-26" },
];
// On the statement, not tracked in the app. Reported, never invented.
const DUST = [
  { code: "MCBPSM", units: 0.0044, nav: 376.8492, value: 1.66 },
  { code: "MCBPSF", units: 0.0904, nav: 56.03, value: 5.07 },
];
const STATEMENT_TOTAL = 86989.05;

const r2 = (v) => Math.round(v * 100) / 100;
const close = (a, b, tol) => Math.abs(a - b) <= tol;

const uri = process.env.MONGODB_URI;
const dry = process.env.DRY_RUN === "1";
if (!uri) {
  console.error("MONGODB_URI is required.");
  process.exit(1);
}

const run = async () => {
  // --- the statement must agree with itself before we trust it -------------
  const problems = [];
  for (const f of [...TRACKED, ...DUST]) {
    if (!close(f.units * f.nav, f.value, 0.02)) {
      problems.push(`${f.code}: ${f.units} x ${f.nav} = ${r2(f.units * f.nav)} != printed ${f.value}`);
    }
  }
  const sum = r2([...TRACKED, ...DUST].reduce((s, f) => s + f.value, 0));
  if (!close(sum, STATEMENT_TOTAL, 0.02)) {
    problems.push(`fund values sum to ${sum}, statement total is ${STATEMENT_TOTAL}`);
  }
  if (problems.length > 0) {
    console.error("REFUSING — the statement does not reconcile with itself:");
    for (const p of problems) console.error("  " + p);
    process.exit(1);
  }
  console.log(`Statement reconciles with itself: every fund value, and the total ${STATEMENT_TOTAL}.\n`);

  await mongoose.connect(uri);
  const col = mongoose.connection.collection("mutualfunds");

  const updates = [];
  for (const f of TRACKED) {
    const doc = await col.findOne({ userId: USER_ID, mufapName: f.mufapName });
    if (!doc) {
      console.error(`REFUSING — no record for ${f.mufapName}.`);
      await mongoose.disconnect();
      process.exit(1);
    }
    const unitsMatch = close(doc.units, f.units, 0.0001);
    console.log(`${f.code}`);
    console.log(`  app     ${String(doc.units).padStart(10)} units, anchored ${doc.anchorDate}`);
    console.log(`  stmt    ${String(f.units).padStart(10)} units, as on   ${f.asOf}   ${unitsMatch ? "— match" : "— DIFFER"}`);
    if (!unitsMatch) {
      console.error(
        `REFUSING — ${f.code} holds ${doc.units} but the statement closes at ${f.units}. A unit change needs the activity rows, which this statement does not parse cleanly. Check it by hand.`
      );
      await mongoose.disconnect();
      process.exit(1);
    }
    console.log(`  value at ${f.nav} = Rs ${f.value.toFixed(2)}; cost basis left at ${doc.avgCost.toFixed(6)}\n`);
    if (doc.anchorDate !== f.asOf) updates.push({ _id: doc._id, code: f.code, from: doc.anchorDate, to: f.asOf });
  }

  console.log("On the statement but not tracked here (dust, left alone):");
  for (const d of DUST) console.log(`  ${d.code}: ${d.units} units, Rs ${d.value.toFixed(2)}`);
  console.log(
    `  the app will show Rs ${r2(TRACKED.reduce((s, f) => s + f.value, 0)).toFixed(2)} of the statement's Rs ${STATEMENT_TOTAL.toFixed(2)}; the Rs ${r2(DUST.reduce((s, d) => s + d.value, 0)).toFixed(2)} difference is those two.\n`
  );

  if (updates.length === 0) {
    console.log("anchors already current — nothing to write.");
    await mongoose.disconnect();
    return;
  }
  for (const u of updates) console.log(`  ${u.code}: anchor ${u.from} -> ${u.to}`);

  if (dry) {
    console.log("\n[DRY RUN] nothing written.");
    await mongoose.disconnect();
    return;
  }
  for (const u of updates) {
    await col.updateOne({ _id: u._id }, { $set: { anchorDate: u.to, updatedAt: new Date() } });
  }
  console.log(`\nadvanced ${updates.length} anchor date(s). Units and cost basis unchanged.`);
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("apply failed:", err);
  process.exit(1);
});
