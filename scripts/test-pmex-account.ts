// PMEX account reconciliation tests.
// Run: npx tsx scripts/test-pmex-account.ts
//
// The fixture is the real general ledger for account 200588420, 1–26 August
// 2026, transcribed from the PMEX MT5 back-office export. Its own balance
// column is the control: opening 316.25, closing 24,246.03.

import { summarisePmexAccount, costDragRatio, type PmexMovement } from "../lib/calculations/pmex-account";

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, extra = "") {
  cond ? (pass++, console.log(`  ok   ${label}`)) : (fail++, console.log(`  FAIL ${label}  ${extra}`));
}

const OPENING = 316.25;
const CLOSING = 24246.03;

// Client's perspective: positive increases the account.
const LEDGER: PmexMovement[] = [
  { date: "2026-08-15", kind: "PROFIT_DISTRIBUTION", amount: 2.14 },
  { date: "2026-08-19", kind: "DEPOSIT", amount: 25000 },
  { date: "2026-08-19", kind: "BANK_CHARGES", amount: -28.75 },
  { date: "2026-08-20", kind: "FEES", amount: -4.13 },
  { date: "2026-08-20", kind: "UNREALISED_PL", amount: -224.86 },
  { date: "2026-08-20", kind: "COMMISSION", amount: -16.16 },
  { date: "2026-08-20", kind: "CGT_FEE", amount: -100 },
  { date: "2026-08-21", kind: "FEES", amount: -4.13 },
  { date: "2026-08-21", kind: "REALISED_PL", amount: 552.42 },
  { date: "2026-08-21", kind: "COMMISSION", amount: -16.16 },
  { date: "2026-08-21", kind: "CGT", amount: -16.38 },
  { date: "2026-08-25", kind: "FEES", amount: -8.25 },
  { date: "2026-08-25", kind: "REALISED_PL", amount: 58.29 },
  { date: "2026-08-25", kind: "COMMISSION", amount: -32.32 },
  { date: "2026-08-25", kind: "CGT", amount: -2.91 },
  { date: "2026-08-26", kind: "FEES", amount: -49.51 },
  { date: "2026-08-26", kind: "REALISED_PL", amount: -854.88 },
  { date: "2026-08-26", kind: "COMMISSION", amount: -193.92 },
  { date: "2026-08-26", kind: "CGT", amount: 19.29 }, // refund
  { date: "2026-08-26", kind: "CGT_FEE", amount: -150 },
];

console.log("the real August 2026 ledger cross-foots");
const s = summarisePmexAccount(OPENING, LEDGER, CLOSING);
ok("computed closing equals the printed closing", s.reconciles, `${s.computedClosing} vs ${s.closingBalance}`);
ok("no discrepancy", s.discrepancy === 0, String(s.discrepancy));
ok("closing is 24,246.03", s.computedClosing === 24246.03, String(s.computedClosing));

console.log("\nthe parts are reported the way a person would read them");
ok("deposit 25,000", s.deposits === 25000, String(s.deposits));
ok("realised P/L is a net LOSS of 244.17", s.realisedPl === -244.17, String(s.realisedPl));
ok("unrealised mark -224.86", s.unrealisedPl === -224.86, String(s.unrealisedPl));
ok("trading P/L -469.03", s.tradingPl === -469.03, String(s.tradingPl));
ok("commission 258.56 shown positive as a cost", s.commission === 258.56, String(s.commission));
ok("fees 66.02", s.fees === 66.02, String(s.fees));
ok("CGT nets to zero after the refund", s.cgt === 0, String(s.cgt));
ok("CGT fee 250", s.cgtFee === 250, String(s.cgtFee));
ok("bank charges 28.75", s.bankCharges === 28.75, String(s.bankCharges));
ok("profit distribution 2.14", s.profitDistribution === 2.14, String(s.profitDistribution));
ok("total costs 603.33", s.totalCosts === 603.33, String(s.totalCosts));
ok("net of costs -1,072.36", s.netOfCosts === -1072.36, String(s.netOfCosts));

console.log("\nthe account balance is explained end to end");
// opening + deposit + distribution + trading - costs = closing
const rebuilt = 316.25 + 25000 + 2.14 + -469.03 - 603.33;
ok("opening + money in + trading - costs = closing", Math.abs(rebuilt - CLOSING) < 0.005, String(rebuilt));

console.log("\ncost drag is stated, not hidden");
const drag = costDragRatio(s);
ok("costs were 1.29x what the trading moved", drag != null && Math.abs(drag - 603.33 / 469.03) < 0.001, String(drag));
ok("no trading at all → null, never Infinity", costDragRatio(summarisePmexAccount(100, [], 100)) === null);

console.log("\na ledger that does not add up refuses to be believed");
const broken = summarisePmexAccount(OPENING, LEDGER.slice(0, -1), CLOSING);
ok("missing row → reconciles false", broken.reconciles === false);
ok("and the gap is named", Math.abs(broken.discrepancy - 150) < 0.005, String(broken.discrepancy));

console.log("\nan OPENING row in the list is not double-counted");
const withOpening = summarisePmexAccount(OPENING, [{ date: "2026-08-01", kind: "OPENING", amount: OPENING }, ...LEDGER], CLOSING);
ok("still reconciles", withOpening.reconciles, String(withOpening.computedClosing));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
