// Bring the MCB funds up to the statement issued 12 September 2026 (09:55).
//
// MCB dates the activity ahead: the statement period reads 14-SEP-2026, the
// investment is dated 14-SEP-26 and the "last balance" 13-SEP-26, although the
// statement was generated on Saturday the 12th. The anchor written here is
// the issue date, 2026-09-12, which is the last day the figures can be known
// for; the app carries the fund forward from there.
//
//   opening (last balance)        1,503.7355 units
//   online investment              +763.1811 units  (Rs 80,000 @ 104.8244)
//   -------------------------------------------------
//   closing                       2,266.9166 units  = Rs 237,628.17 at 104.8244
//
// Accepts the app sitting at the opening or the closing balance and refuses
// anything else, so it is safe to run twice and refuses to guess past
// activity this statement does not show.
//
//   MONGODB_URI=... DRY_RUN=1 node scripts/update-mcb-20260912.mjs
//   MONGODB_URI=... node scripts/update-mcb-20260912.mjs
//
import mongoose from "mongoose";

const USER_ID = "6a368e470160489b1b496fd1";
const STATEMENT_DATE = "2026-09-12";

const CMO = {
  fund: "MCB Cash Management Optimizer",
  openingUnits: 1503.7355, // last balance, printed as 13-SEP-26
  tranches: [{ units: 763.1811, rs: 80000, rate: 104.8244, after: 2266.9166 }],
  closingUnits: 2266.9166,
  repurchasePrice: 104.8244, // as on 14 SEP 2026 in MCB's dating
  closingValue: 237628.17,
};
const ALHDDF = {
  fund: "Alhamra Daily Dividend Fund",
  closingUnits: 0.1378, // no activity
  price: 100, // as on 12 SEP 2026
  closingValue: 13.78,
};
// Printed to one decimal on this statement (1.5 and 5.0); the values below are
// units x price, which is what the printed total was summed from.
const UNTRACKED = [
  { fund: "MCB Pakistan Stock Market Fund", units: 0.0044, price: 360.8614 },
  { fund: "MCB Pakistan Sovereign Fund", units: 0.0903, price: 56.14 },
];
const STATEMENT_TOTAL = 237648.61;

const r2 = (v) => Math.round(v * 100) / 100;
const close = (a, b, tol) => Math.abs(a - b) <= tol;
const rs = (v) => v.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const uri = process.env.MONGODB_URI;
const dry = process.env.DRY_RUN === "1";
if (!uri) {
  console.error("MONGODB_URI is required.");
  process.exit(1);
}

const run = async () => {
  const problems = [];
  let running = CMO.openingUnits;
  for (const [i, t] of CMO.tranches.entries()) {
    running = Math.round((running + t.units) * 10000) / 10000;
    if (!close(running, t.after, 0.0001)) problems.push(`unit chain after tranche ${i + 1}: ${running} != ${t.after}`);
    if (!close(t.rs / t.rate, t.units, 0.0005)) problems.push(`tranche ${i + 1}: ${t.rs} / ${t.rate} = ${(t.rs / t.rate).toFixed(4)} != ${t.units}`);
  }
  if (!close(running, CMO.closingUnits, 0.0001)) problems.push(`chain ends at ${running}, statement closes at ${CMO.closingUnits}`);
  if (!close(CMO.closingUnits * CMO.repurchasePrice, CMO.closingValue, 0.02)) {
    problems.push(`CMO closing value: ${CMO.closingUnits} x ${CMO.repurchasePrice} = ${r2(CMO.closingUnits * CMO.repurchasePrice)} != ${CMO.closingValue}`);
  }
  if (!close(ALHDDF.closingUnits * ALHDDF.price, ALHDDF.closingValue, 0.01)) problems.push("ALHDDF value mismatch");
  const dust = UNTRACKED.reduce((s, u) => s + u.units * u.price, 0);
  const sumAll = CMO.closingValue + ALHDDF.closingValue + dust;
  if (!close(sumAll, STATEMENT_TOTAL, 0.02)) problems.push(`fund values sum to ${r2(sumAll)}, statement total is ${STATEMENT_TOTAL}`);
  if (problems.length > 0) {
    console.error("REFUSING: the statement does not reconcile with itself:");
    for (const p of problems) console.error("  " + p);
    process.exit(1);
  }
  console.log("Statement reconciles with itself: the unit chain, the tranche, every closing value, and the printed total.\n");

  await mongoose.connect(uri);
  const col = mongoose.connection.collection("mutualfunds");

  const cmo = await col.findOne({ userId: USER_ID, mufapName: CMO.fund });
  if (!cmo) {
    console.error(`REFUSING: no ${CMO.fund} record found.`);
    await mongoose.disconnect();
    process.exit(1);
  }
  const chain = [CMO.openingUnits, ...CMO.tranches.map((t) => t.after)];
  const at = chain.findIndex((u) => close(cmo.units, u, 0.0001));
  if (at < 0) {
    console.error(
      `REFUSING: the app holds ${cmo.units} units, which is no point on this statement's chain (${chain.join(" -> ")}).\n` +
        "  Something happened that this statement does not show. Reconcile that first."
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  const pending = CMO.tranches.slice(at);
  const addRs = pending.reduce((s, t) => s + t.rs, 0);
  const startCost = cmo.units * (cmo.avgCost ?? 0);
  const newCost = startCost + addRs;
  const newAvg = CMO.closingUnits > 0 ? newCost / CMO.closingUnits : 0;

  console.log("MCB Cash Management Optimizer");
  console.log(`  app is at   ${cmo.units} units (${at === 0 ? "the statement's opening" : `after tranche ${at}`}), anchor ${cmo.anchorDate}`);
  if (pending.length === 0) console.log("  nothing pending: already at the statement's closing balance.");
  else for (const t of pending) console.log(`  applying    +${t.units} units for Rs ${rs(t.rs)} @ ${t.rate}`);
  console.log(`  units       ${cmo.units}  ->  ${CMO.closingUnits}`);
  console.log(`  avg cost    ${(cmo.avgCost ?? 0).toFixed(4)}  ->  ${newAvg.toFixed(4)}`);
  console.log(`  book cost   Rs ${rs(startCost)}  ->  Rs ${rs(newCost)}`);
  console.log(`  value       Rs ${rs(CMO.closingValue)} at NAV ${CMO.repurchasePrice} (MCB dates it 14 Sep)`);
  console.log(`  unrealised  Rs ${rs(CMO.closingValue - newCost)}`);

  const alh = await col.findOne({ userId: USER_ID, mufapName: ALHDDF.fund });
  if (alh && !close(alh.units, ALHDDF.closingUnits, 0.0001)) {
    console.error(`REFUSING: the app holds ${alh.units} ALHDDF units but the statement says ${ALHDDF.closingUnits} with no activity.`);
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`\nAlhamra Daily Dividend Fund\n  ${ALHDDF.closingUnits} units unchanged, worth Rs ${rs(ALHDDF.closingValue)}`);
  console.log("\nOn the statement but not tracked here (dust, left alone):");
  for (const u of UNTRACKED) console.log(`  ${u.fund}: ${u.units} units = Rs ${rs(u.units * u.price)}`);
  console.log(`\nStatement total Rs ${rs(STATEMENT_TOTAL)}; tracked here Rs ${rs(CMO.closingValue + ALHDDF.closingValue)}.`);

  if (dry) {
    console.log("\nDRY_RUN: nothing written.");
    await mongoose.disconnect();
    return;
  }

  await col.updateOne({ _id: cmo._id }, { $set: { units: CMO.closingUnits, avgCost: newAvg, anchorDate: STATEMENT_DATE, moneyMarket: true } });
  if (alh) await col.updateOne({ _id: alh._id }, { $set: { anchorDate: STATEMENT_DATE, moneyMarket: true } });

  // The NAV snapshot is left alone on purpose: it holds what MUFAP has actually
  // published, and the app carries that forward daily. The statement quotes a
  // NAV ahead of MUFAP's, so writing it in would report a figure with no source.

  const after = await col.find({ userId: USER_ID }).toArray();
  console.log("\nWritten.");
  for (const f of after) console.log(`  ${f.mufapName}: ${f.units} units, avg ${(f.avgCost ?? 0).toFixed(4)}, anchor ${f.anchorDate}, moneyMarket ${f.moneyMarket}`);
  await mongoose.disconnect();
};

run().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
