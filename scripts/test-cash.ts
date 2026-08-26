// Cash ledger tests.
// Run: npx tsx scripts/test-cash.ts
//
// The rule under test: a brokerage balance can rest at zero but can never be
// negative. This book was rebuilt from a tax certificate that carries every
// trade and no cash movements, so a shortfall means a deposit went unrecorded,
// not that shares were bought with money that did not exist.

import { computeCashBalance } from "../lib/calculations/cash";

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, extra = "") {
  cond ? (pass++, console.log(`  ok   ${label}`)) : (fail++, console.log(`  FAIL ${label}  ${extra}`));
}

const buy = (date: string, netAmount: number) => ({ type: "BUY", date, netAmount } as never);
const sell = (date: string, netAmount: number) => ({ type: "SELL", date, netAmount } as never);
const div = (date: string, netAmount: number) => ({ type: "DIVIDEND", date, netAmount } as never);
const dep = (date: string, amount: number) => ({ type: "DEPOSIT" as const, date, amount });
const wd = (date: string, amount: number) => ({ type: "WITHDRAWAL" as const, date, amount });

console.log("the ordinary case: funded, then spent");
const a = computeCashBalance([buy("2026-08-10", 4000)], [dep("2026-08-01", 10000)]);
ok("balance is what is left", a.balance === 6000, String(a.balance));
ok("nothing implied", a.impliedDeposits === 0 && a.topUps.length === 0);

console.log("\nspending with an empty ledger implies the deposit");
const b = computeCashBalance([buy("2026-08-10", 4923.38)], []);
ok("balance floors at zero", b.balance === 0, String(b.balance));
ok("top-up equals the spend", b.impliedDeposits === 4923.38, String(b.impliedDeposits));
ok("one top-up, dated at the buy", b.topUps.length === 1 && b.topUps[0].date === "2026-08-10");
ok("top-up says why", b.topUps[0].reason.includes("not in the ledger"));

console.log("\nnever negative, however deep the shortfall");
const c = computeCashBalance([buy("2026-08-02", 500), buy("2026-08-03", 700), buy("2026-08-04", 900)], [dep("2026-08-01", 100)]);
ok("balance never goes under", c.balance >= 0, String(c.balance));
ok("three shortfalls booked", c.topUps.length === 3, String(c.topUps.length));
ok("implied total covers the gap", Math.abs(c.impliedDeposits - (2100 - 100)) < 0.01, String(c.impliedDeposits));

console.log("\nsame-day credit lands before the debit it funds");
const d = computeCashBalance([buy("2026-08-19", 35000)], [dep("2026-08-19", 35000)]);
ok("no spurious top-up", d.impliedDeposits === 0, JSON.stringify(d.topUps));
ok("balance settles at zero", d.balance === 0, String(d.balance));

console.log("\nsells and dividends are cash in");
const e = computeCashBalance([sell("2026-08-05", 9000), div("2026-08-06", 1000)], [dep("2026-08-01", 500)]);
ok("proceeds credited", e.proceedsFromSells === 9000);
ok("dividends credited", e.dividendsCollected === 1000);
ok("balance adds up", e.balance === 10500, String(e.balance));

console.log("\na sell later the same day still funds that day's buy");
const f = computeCashBalance([buy("2026-08-07", 5000), sell("2026-08-07", 5000)], []);
ok("credit first → nothing implied", f.impliedDeposits === 0, JSON.stringify(f.topUps));

console.log("\nwithdrawing more than is there is a shortfall too");
const g = computeCashBalance([], [dep("2026-08-01", 1000), wd("2026-08-02", 2500)]);
ok("floors at zero", g.balance === 0, String(g.balance));
ok("shortfall implied", Math.abs(g.impliedDeposits - 1500) < 0.01, String(g.impliedDeposits));

console.log("\nshare-only events move no money");
const h = computeCashBalance(
  [{ type: "BONUS", date: "2026-08-01", netAmount: 0 } as never, { type: "SPLIT", date: "2026-08-02", netAmount: 0 } as never],
  [dep("2026-08-01", 1000)]
);
ok("bonus and split leave cash alone", h.balance === 1000 && h.impliedDeposits === 0, String(h.balance));

console.log("\ntotals stay reportable alongside the floor");
const i = computeCashBalance([buy("2026-08-10", 4000)], [dep("2026-08-01", 1000)]);
ok("gross spend still visible", i.spentOnBuys === 4000);
ok("recorded deposits still visible", i.deposits === 1000);
ok("the assumed 3000 is separate, not folded in", i.impliedDeposits === 3000 && i.balance === 0);

// --- CGT held back out of sale proceeds --------------------------------------
// Tax is 15% of the REALISED GAIN, matched FIFO — never 15% of the proceeds,
// and never anything at all on a loss.
const sBuy = (symbol: string, date: string, shares: number, netAmount: number) =>
  ({ symbol, type: "BUY", date, shares, netAmount } as never);
const sSell = (symbol: string, date: string, shares: number, netAmount: number) =>
  ({ symbol, type: "SELL", date, shares: -shares, netAmount } as never);

console.log("\nselling at a gain: the tax never reaches spendable cash");
// 100 @ 100 = 10,000 cost; sold 100 for 12,000 → gain 2,000 → CGT 300.
const t1 = computeCashBalance([sBuy("LUCK", "2026-01-10", 100, 10000), sSell("LUCK", "2026-06-10", 100, 12000)], []);
ok("tax is 15% of the gain, not the proceeds", t1.cgtWithheld === 300, String(t1.cgtWithheld));
ok("cash credited is proceeds less tax", t1.balance === 11700, String(t1.balance));
ok("gross proceeds still reported in full", t1.proceedsFromSells === 12000);

console.log("\nselling at a loss is not taxed");
const t2 = computeCashBalance([sBuy("PTL", "2026-01-10", 100, 10000), sSell("PTL", "2026-06-10", 100, 8000)], []);
ok("nothing withheld on a loss", t2.cgtWithheld === 0, String(t2.cgtWithheld));
ok("full proceeds credited", t2.balance === 8000, String(t2.balance));

console.log("\ngains are matched FIFO, not against the average");
// Two lots: 100 @ 50 then 100 @ 150. Sell 100 for 12,000 → FIFO gain 12,000-5,000
// = 7,000 (average cost would have said 2,000). CGT 1,050.
const t3 = computeCashBalance(
  [sBuy("MARI", "2026-01-10", 100, 5000), sBuy("MARI", "2026-02-10", 100, 15000), sSell("MARI", "2026-06-10", 100, 12000)],
  []
);
ok("FIFO gain taxed", t3.cgtWithheld === 1050, String(t3.cgtWithheld));

console.log("\ntwo tickets, one symbol, one day: split, not double-taxed");
const t4 = computeCashBalance(
  [sBuy("MEBL", "2026-01-10", 200, 20000), sSell("MEBL", "2026-06-10", 100, 12000), sSell("MEBL", "2026-06-10", 100, 12000)],
  []
);
// Each sells 100 of a 100/share lot for 120 → gain 2,000 each → 300 each.
ok("total withheld is 600, not 1,200", Math.abs(t4.cgtWithheld - 600) < 0.01, String(t4.cgtWithheld));
ok("balance is both sales less both taxes", Math.abs(t4.balance - 23400) < 0.01, String(t4.balance));

console.log("\nthe rate is configurable and zero disables withholding");
const t5 = computeCashBalance([sBuy("HUBC", "2026-01-10", 100, 10000), sSell("HUBC", "2026-06-10", 100, 12000)], [], { cgtRatePct: 20 });
ok("non-filer rate applies", t5.cgtWithheld === 400, String(t5.cgtWithheld));
const t6 = computeCashBalance([sBuy("HUBC", "2026-01-10", 100, 10000), sSell("HUBC", "2026-06-10", 100, 12000)], [], { cgtRatePct: 0 });
ok("zero rate withholds nothing", t6.cgtWithheld === 0 && t6.balance === 12000, String(t6.balance));

console.log("\nwithholding never turns a sale into a debit");
const t7 = computeCashBalance([sBuy("AHCL", "2026-01-10", 100, 1), sSell("AHCL", "2026-06-10", 100, 100)], []);
ok("credit stays non-negative", t7.balance >= 0 && t7.cgtWithheld <= 100, `${t7.balance} / ${t7.cgtWithheld}`);

console.log("\nheld-back tax can itself create a shortfall, and that is honest");
// Sell for 12,000 (300 tax → 11,700 usable), then spend 12,000 the next day.
const t8 = computeCashBalance(
  [sBuy("INDU", "2026-01-10", 100, 10000), sSell("INDU", "2026-06-10", 100, 12000), { symbol: "LUCK", type: "BUY", date: "2026-06-11", shares: 1, netAmount: 12000 } as never],
  []
);
// The opening buy was itself unfunded, so it implies 10,000 of its own; the
// gap that matters here is the last one — exactly the 300 held back for tax.
ok("the 300 gap is implied, not borrowed", Math.abs(t8.topUps[t8.topUps.length - 1].amount - 300) < 0.01, JSON.stringify(t8.topUps));
ok("implied total is the opening buy plus that gap", Math.abs(t8.impliedDeposits - 10300) < 0.01, String(t8.impliedDeposits));
ok("balance still floors at zero", t8.balance === 0, String(t8.balance));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
