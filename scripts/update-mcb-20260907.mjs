// Bring the MCB funds up to the statement of 7 September 2026.
//
// The chain is clean. The statement's 06-SEP opening for the optimizer is
// 978.0209 units, which is exactly what the app already holds from the 31-AUG
// reconciliation, so there is no hidden activity to derive. One transaction:
//
//   opening 06-SEP                978.0209 units
//   07-SEP online investment      477.9224 units  (Rs 50,000 @ 104.6195)
//   ------------------------------------------------
//   closing                     1,455.9433 units
//
// Cost basis convention is unchanged: new money adds its cost and re-blends the
// average. Nothing that already happened is rewritten.
//
// This run also sets moneyMarket explicitly on both tracked funds. It was never
// stored, so the app was inferring it from the fund's NAME — which happens to
// catch "Cash Management Optimizer" and misses "Alhamra Daily Dividend Fund",
// leaving a daily-dividend fund classified as growth and not accruing. A
// classification that depends on a word in a marketing name is a coin toss.
//
// Every figure the statement prints is checked before anything is written: the
// unit chain, the units bought against the rate, each closing value, and the
// printed grand total. If any of them disagree the script stops rather than
// writing a number the statement does not support.
//
//   MONGODB_URI=... DRY_RUN=1 node scripts/update-mcb-20260907.mjs
//   MONGODB_URI=... node scripts/update-mcb-20260907.mjs
//
import mongoose from "mongoose";

const USER_ID = "6a368e470160489b1b496fd1";
const STATEMENT_DATE = "2026-09-07";

// --- exactly what the statement prints --------------------------------------
const CMO = {
  fund: "MCB Cash Management Optimizer",
  lastBalanceUnits: 978.0209, // closing 06-SEP-26
  investedRs: 50000,
  investedRate: 104.6195,
  investedUnits: 477.9224,
  closingUnits: 1455.9433,
  repurchasePrice: 104.6195, // as on 07 SEP 2026
  closingValue: 152320.05,
};
const ALHDDF = {
  fund: "Alhamra Daily Dividend Fund",
  closingUnits: 0.1378, // no activity
  price: 100, // as on 05 SEP 2026
  closingValue: 13.78,
};
// Present on the statement but not tracked in the app — noted, not invented.
// Both are dust: together they are under Rs 7.
const UNTRACKED = [
  { fund: "MCB Pakistan Stock Market Fund", units: 0.0044, price: 373.0241, value: 1.64 },
  { fund: "MCB Pakistan Sovereign Fund", units: 0.0903, price: 56.16, value: 5.07 },
];
const STATEMENT_TOTAL = 152340.55;

// The optimizer and the daily-dividend fund are both cash instruments: they
// hold short-dated paper and pay out daily. Stating it beats inferring it.
const MONEY_MARKET = [CMO.fund, ALHDDF.fund];

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
  // --- the statement must agree with itself before we trust it --------------
  const problems = [];
  if (!close(CMO.lastBalanceUnits + CMO.investedUnits, CMO.closingUnits, 0.0001)) {
    problems.push(`unit chain: ${CMO.lastBalanceUnits} + ${CMO.investedUnits} != ${CMO.closingUnits}`);
  }
  if (!close(CMO.investedRs / CMO.investedRate, CMO.investedUnits, 0.0005)) {
    problems.push(`units bought: ${CMO.investedRs} / ${CMO.investedRate} != ${CMO.investedUnits}`);
  }
  if (!close(CMO.closingUnits * CMO.repurchasePrice, CMO.closingValue, 0.02)) {
    problems.push(
      `CMO closing value: ${CMO.closingUnits} x ${CMO.repurchasePrice} = ${r2(CMO.closingUnits * CMO.repurchasePrice)} != ${CMO.closingValue}`
    );
  }
  if (!close(ALHDDF.closingUnits * ALHDDF.price, ALHDDF.closingValue, 0.01)) {
    problems.push("ALHDDF value mismatch");
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

  const already = close(cmo.units, CMO.closingUnits, 0.0001);
  if (already) {
    console.log("MCBCMO is already at the statement balance — units will not be touched.");
  } else if (!close(cmo.units, CMO.lastBalanceUnits, 0.0001)) {
    // The app must be sitting exactly on the statement's opening. If it is not,
    // something happened between statements that this script does not model,
    // and guessing would corrupt the cost basis.
    const delta = r2((cmo.units - CMO.lastBalanceUnits) * 10000) / 10000;
    console.error(
      `REFUSING — the app holds ${cmo.units} units but the statement's 06-SEP opening is ${CMO.lastBalanceUnits} (difference ${delta}).\n` +
        "  There is activity between the two that this statement does not show. Reconcile that first."
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  const startCost = cmo.units * (cmo.avgCost ?? 0);
  const newCost = already ? startCost : startCost + CMO.investedRs;
  const newAvg = CMO.closingUnits > 0 ? newCost / CMO.closingUnits : 0;

  console.log("MCB Cash Management Optimizer");
  console.log(`  units      ${cmo.units}  ->  ${CMO.closingUnits}   (+${CMO.investedUnits} for Rs ${rs(CMO.investedRs)})`);
  console.log(`  avg cost   ${(cmo.avgCost ?? 0).toFixed(4)}  ->  ${newAvg.toFixed(4)}`);
  console.log(`  book cost  Rs ${rs(startCost)}  ->  Rs ${rs(newCost)}`);
  console.log(`  value      Rs ${rs(CMO.closingValue)} at NAV ${CMO.repurchasePrice} on ${STATEMENT_DATE}`);
  console.log(`  unrealised Rs ${rs(CMO.closingValue - newCost)}`);

  const alh = await col.findOne({ userId: USER_ID, mufapName: ALHDDF.fund });
  if (alh && !close(alh.units, ALHDDF.closingUnits, 0.0001)) {
    console.error(
      `REFUSING — the app holds ${alh.units} ALHDDF units but the statement says ${ALHDDF.closingUnits} with no activity.`
    );
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`\nAlhamra Daily Dividend Fund\n  units ${ALHDDF.closingUnits} unchanged, worth Rs ${rs(ALHDDF.closingValue)}`);

  console.log("\nOn the statement but not tracked here (dust, left alone):");
  for (const u of UNTRACKED) console.log(`  ${u.fund}: ${u.units} units = Rs ${rs(u.value)}`);
  console.log(`\nStatement total Rs ${rs(STATEMENT_TOTAL)}; tracked here Rs ${rs(CMO.closingValue + ALHDDF.closingValue)}.`);

  if (dry) {
    console.log("\nDRY_RUN — nothing written.");
    await mongoose.disconnect();
    return;
  }

  if (!already) {
    await col.updateOne(
      { _id: cmo._id },
      { $set: { units: CMO.closingUnits, avgCost: newAvg, anchorDate: STATEMENT_DATE, moneyMarket: true } }
    );
  } else {
    await col.updateOne({ _id: cmo._id }, { $set: { anchorDate: STATEMENT_DATE, moneyMarket: true } });
  }

  if (alh) {
    await col.updateOne({ _id: alh._id }, { $set: { anchorDate: STATEMENT_DATE, moneyMarket: true } });
  }

  // The NAV snapshot is deliberately NOT touched. It stores what MUFAP has
  // actually published ({ at, navs: [...] }), and the app values money-market
  // funds by carrying that last published NAV forward day by day. Writing the
  // statement's repurchase price into it would be inserting a figure MUFAP has
  // not published yet — the statement is dated ahead of the public NAV — and
  // the app would then report a value it cannot source.

  const after = await col.find({ userId: USER_ID }).toArray();
  const total = after.reduce((s, f) => {
    const nav = f.mufapName === CMO.fund ? CMO.repurchasePrice : ALHDDF.price;
    return s + f.units * nav;
  }, 0);
  console.log(`\nWritten. Tracked fund value is now Rs ${rs(total)}.`);
  for (const f of after) {
    console.log(`  ${f.mufapName}: ${f.units} units, avg ${(f.avgCost ?? 0).toFixed(4)}, anchor ${f.anchorDate}, moneyMarket ${f.moneyMarket}`);
  }

  await mongoose.disconnect();
};

run().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
