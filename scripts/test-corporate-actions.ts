// Checks for the automatic dividend and bonus recording (lib/corporate-actions).
//   npx tsx scripts/test-corporate-actions.ts
import { businessDaysBefore, lastEntitledTradeDate, sharesEntitled, dividendFigures, bonusFigures, planDueActions, payoutStanding, staleAutoDividends, financialYearLabel, actionKeyOf, type AutoSettings } from "../lib/calculations/corporate-actions";

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else {
    failed++;
    console.log(`FAIL ${name} ${detail}`);
  }
}
const eq = (name: string, got: unknown, want: unknown) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const S: AutoSettings = { autoDividends: true, autoBonus: true, dividendWhtPct: 15, zakatOnDividends: "none", bonusTaxWithheld: true, bonusTaxPct: 10 };

// Business days: Friday 17 Oct 2025 back 3 business days is Tuesday 14 Oct;
// the entitlement cutoff is two business days before a closure (T+1).
eq("businessDaysBefore over a plain week", businessDaysBefore("2025-10-17", 3), "2025-10-14");
eq("businessDaysBefore over a weekend", businessDaysBefore("2025-10-20", 1), "2025-10-17");
eq("last entitled trade date, closure on Friday", lastEntitledTradeDate("2025-10-17"), "2025-10-15");
eq("last entitled trade date, closure on Monday", lastEntitledTradeDate("2026-09-21"), "2026-09-17");
eq("last entitled trade date, closure on Tuesday", lastEntitledTradeDate("2026-09-22"), "2026-09-18");

const tx = (symbol: string, type: string, date: string, shares: number, price = 100, extra: Record<string, unknown> = {}) => ({ symbol, type, date, shares, pricePerShare: price, netAmount: shares * price, ratio: "", ...extra });

// Entitlement counts trades up to the cutoff, including a bonus before it.
const ledger = [tx("LUCK", "BUY", "2026-01-10", 300), tx("LUCK", "BUY", "2026-09-17", 76), tx("LUCK", "BONUS", "2026-03-01", 30, 0)];
eq("shares entitled excludes the late buy", sharesEntitled(ledger as any, "LUCK", "2026-09-18"), 330);
eq("shares entitled includes a buy on the cutoff day", sharesEntitled([...ledger, tx("LUCK", "BUY", "2026-09-16", 0), tx("LUCK", "BUY", "2026-09-16", 10)] as any, "LUCK", "2026-09-18"), 340);
eq("shares entitled with a sale before the closure", sharesEntitled([...ledger, tx("LUCK", "SELL", "2026-09-10", -100)] as any, "LUCK", "2026-09-18"), 230);
eq("shares entitled for a name not held", sharesEntitled(ledger as any, "MEBL", "2026-09-18"), 0);

// Dividend figures: 250% of a Rs 10 face on 376 shares, 15% tax.
eq("dividend figures", dividendFigures(376, 250, 10, S), { rate: 25, gross: 9400, tax: 1410, zakat: 0, net: 7990 });
eq("dividend with zakat on paid-up value", dividendFigures(25, 20, 10, { ...S, zakatOnDividends: "paidUp" }), { rate: 2, gross: 50, tax: 7.5, zakat: 6.25, net: 36.25 });
eq("dividend zakat never exceeds the net", dividendFigures(100, 1, 10, { ...S, zakatOnDividends: "paidUp" }), { rate: 0.1, gross: 10, tax: 1.5, zakat: 8.5, net: 0 });
eq("bonus figures with 10% withheld", bonusFigures(1067, 20, S), { gross: 213, withheld: 21, credited: 192 });
eq("bonus figures without withholding", bonusFigures(100, 15, { ...S, bonusTaxWithheld: false }), { gross: 15, withheld: 0, credited: 15 });
eq("financial year label", financialYearLabel("2026-09-18"), "2026-27");
eq("financial year label before July", financialYearLabel("2026-05-06"), "2025-26");

// Planning: due when the closure has arrived, once per key, not when already on the ledger.
const boards = [
  { symbol: "LUCK", faceValue: 2, payouts: [{ date: "2026-08-10", bookClosure: "2026-09-18", pctOfFace: 250, cycle: "F", payoutType: "cash" }, { date: "2025-08-11", bookClosure: "2025-09-19", pctOfFace: 200, cycle: "F", payoutType: "cash" }] },
  { symbol: "MEBL", faceValue: 10, payouts: [{ date: "2026-04-23", bookClosure: "2026-05-06", pctOfFace: 75, cycle: "i", payoutType: "cash" }] },
  { symbol: "PTL", faceValue: 10, payouts: [{ date: "2026-09-01", bookClosure: "2026-09-10", pctOfFace: 20, cycle: "", payoutType: "bonus" }] },
];
const live = [
  ...ledger,
  tx("MEBL", "BUY", "2025-12-01", 450),
  tx("MEBL", "DIVIDEND", "2026-05-16", 450, 7.5, { netAmount: 2869 }),
  tx("PTL", "BUY", "2026-02-01", 1067),
];
const base = { liveTxs: live as any, usedKeys: new Set<string>(), boards, settings: S, defaultPortfolioId: "p1" };

const before = planDueActions({ ...base, today: "2026-09-17" });
eq("nothing due before the closure (LUCK), old one outside lookback", before.due.map((d) => d.symbol + ":" + d.type), ["PTL:BONUS"]);
eq("the MEBL dividend already on the ledger is skipped", before.skipped.find((s) => s.symbol === "MEBL")?.reason, "already on the ledger");

const onDay = planDueActions({ ...base, today: "2026-09-18" });
const luck = onDay.due.find((d) => d.symbol === "LUCK");
check("LUCK is due on the closure day", !!luck);
eq("LUCK shares entitled and figures: 250% of a Rs 2 face value", luck && [luck.shares, luck.rate, luck.gross, luck.net], [330, 5, 1650, 1402.5]);
// The face value kept wrong (Rs 10, as every company had until October 2026):
// the closing file's Rs 5 off the price on the ex-date sets the rate.
const wrongFace = planDueActions({ ...base, today: "2026-09-18", boards: boards.map((b) => (b.symbol === "LUCK" ? { ...b, faceValue: 10, events: [{ date: "2026-09-17", cash: 5 }] } : b)) });
const fixedLuck = wrongFace.due.find((d) => d.symbol === "LUCK");
eq("a wrong face value kept: the ex-date shows the rate", fixedLuck && [fixedLuck.rate, fixedLuck.faceValue, fixedLuck.gross], [5, 2, 1650]);
const noProof = planDueActions({ ...base, today: "2026-09-18", boards: boards.map((b) => (b.symbol === "LUCK" ? { ...b, faceValue: 10 } : b)) });
eq("no ex-date shown: the kept face value", noProof.due.find((d) => d.symbol === "LUCK")?.rate, 25);
eq("LUCK portfolio is the default", luck?.portfolioId, "p1");
eq("action key", luck?.actionKey, actionKeyOf("LUCK", "DIVIDEND", "2026-09-18", 250));
const ptl = onDay.due.find((d) => d.symbol === "PTL");
eq("PTL bonus credited after withholding", ptl && [ptl.shares, ptl.bonusGross, ptl.bonusWithheld, ptl.bonusCredited], [1067, 213, 21, 192]);

const again = planDueActions({ ...base, today: "2026-09-19", usedKeys: new Set([luck!.actionKey, ptl!.actionKey]) });
eq("a used key is never written twice", again.due.length, 0);

const off = planDueActions({ ...base, today: "2026-09-18", settings: { ...S, autoDividends: false } });
eq("dividends off leaves only the bonus", off.due.map((d) => d.type), ["BONUS"]);

const twoBooks = planDueActions({ ...base, today: "2026-09-18", liveTxs: [...live, tx("LUCK", "BUY", "2026-02-01", 50, 100, { portfolioId: "p2" })] as any });
eq("one row per portfolio", twoBooks.due.filter((d) => d.symbol === "LUCK").map((d) => [d.portfolioId, d.shares]), [["p1", 330], ["p2", 50]]);

const lateBuyer = planDueActions({ ...base, today: "2026-09-18", liveTxs: [tx("LUCK", "BUY", "2026-09-17", 100)] as any });
eq("a buyer after the cutoff gets nothing", lateBuyer.due.length, 0);
eq("and the reason is recorded", lateBuyer.skipped.find((s) => s.symbol === "LUCK")?.reason, "no shares held on the record date");

// One payout has one set of figures, wherever it is shown. PTL: 3,248 held at
// the book closure of 14 Oct, 3,000 sold after the ex-date, 248 held now.
const ptlKey = actionKeyOf("PTL", "DIVIDEND", "2026-10-14", 20);
const ptlTrades = [tx("PTL", "BUY", "2026-01-10", 3248, 50), tx("PTL", "SELL", "2026-10-13", -3000, 40)];
const ptlRow = { ...tx("PTL", "DIVIDEND", "2026-10-14", 3248, 2), totalAmount: 6496, netAmount: 5521.6, taxDeducted: 974.4, zakatDeducted: 0, source: "auto", actionKey: ptlKey };
const ptlPayout = { symbol: "PTL", type: "DIVIDEND" as const, bookClosure: "2026-10-14", pctOfFace: 20, faceValue: 10 };
const shown = payoutStanding([...ptlTrades, ptlRow] as any, ptlPayout, S, "2026-11-04");
eq("recorded: the ledger's own figures, not the shares held today", shown, { status: "recorded", shares: 3248, rate: 2, gross: 6496, net: 5521.6, bonusCredited: 0 });
const notYet = payoutStanding(ptlTrades as any, ptlPayout, S, "2026-10-14");
eq("gone ex, not recorded yet: the shares entitled", [notYet.status, notYet.shares, notYet.gross, notYet.net], ["due", 3248, 6496, 5521.6]);
const addedAfter = [tx("HUBC", "BUY", "2026-01-10", 12, 200), tx("HUBC", "BUY", "2026-10-30", 50, 193)];
eq("bought after the book closure: not paid on them", payoutStanding(addedAfter as any, { symbol: "HUBC", type: "DIVIDEND", bookClosure: "2026-10-13", pctOfFace: 50, faceValue: 10 }, S, "2026-11-04").shares, 12);
const lateIn = payoutStanding([tx("ATIL", "BUY", "2026-10-30", 200, 76)] as any, { symbol: "ATIL", type: "DIVIDEND", bookClosure: "2026-10-20", pctOfFace: 10, faceValue: 10 }, S, "2026-11-04");
eq("nothing held on the record date: not entitled", [lateIn.status, lateIn.shares, lateIn.gross], ["past", 0, 0]);
const coming = payoutStanding([tx("PPL", "BUY", "2026-10-30", 50, 214)] as any, { symbol: "PPL", type: "DIVIDEND", bookClosure: "2026-11-12", pctOfFace: 20, faceValue: 10 }, S, "2026-11-04");
eq("to come: the shares held so far", [coming.status, coming.shares, coming.gross, coming.net], ["upcoming", 50, 100, 85]);
const afterEx = payoutStanding([tx("PPL", "BUY", "2026-01-30", 50, 214), tx("PPL", "BUY", "2026-11-11", 50, 214)] as any, { symbol: "PPL", type: "DIVIDEND", bookClosure: "2026-11-12", pctOfFace: 20, faceValue: 10 }, S, "2026-11-11");
eq("to come, bought on the ex-date: not counted", afterEx.shares, 50);
const typed = { ...tx("MARI", "DIVIDEND", "2026-11-20", 216, 18.7), totalAmount: 4039.2, netAmount: 3433.32 };
eq("typed in by hand: its figures, recorded", payoutStanding([tx("MARI", "BUY", "2026-01-10", 216), typed] as any, { symbol: "MARI", type: "DIVIDEND", bookClosure: "2026-10-22", pctOfFace: 187, faceValue: 10 }, S, "2026-11-22").net, 3433.32);
const rateFixed = { ...ptlRow, pricePerShare: 2.5, totalAmount: 8120, netAmount: 6902 };
eq("a row the job wrote stays this payout's whatever its rate became", payoutStanding([...ptlTrades, rateFixed] as any, ptlPayout, S, "2026-11-04").rate, 2.5);
const bonus = { ...tx("MEBL", "BONUS", "2026-10-14", 91, 0), actionKey: actionKeyOf("MEBL", "BONUS", "2026-10-14", 10) };
const bonusShown = payoutStanding([tx("MEBL", "BUY", "2026-01-10", 918), bonus] as any, { symbol: "MEBL", type: "BONUS", bookClosure: "2026-10-14", pctOfFace: 10, faceValue: 10 }, S, "2026-11-04");
eq("a bonus: the shares entitled and the shares credited", [bonusShown.status, bonusShown.shares, bonusShown.bonusCredited], ["recorded", 918, 91]);
eq("a right is never recorded for you", payoutStanding([tx("MEBL", "BUY", "2026-01-10", 918)] as any, { symbol: "MEBL", type: "RIGHT", bookClosure: "2026-10-14", pctOfFace: 10, faceValue: 10 }, S, "2026-11-04").status, "due");

// The record date with a holiday: the last day to hold moves back a day.
const hol = new Set(["2026-11-09"]);
eq("a holiday moves the last entitled day back", lastEntitledTradeDate("2026-11-11", hol), "2026-11-06");
eq("a trade after it is not entitled", sharesEntitled([tx("MEBL", "BUY", "2026-01-10", 100), tx("MEBL", "BUY", "2026-11-09", 50)] as any, "MEBL", "2026-11-11", hol), 100);

// A dividend recorded before the trade it depends on reached the ledger.
const lateTrade = [tx("AHCL", "BUY", "2026-01-10", 21000, 15), tx("AHCL", "BUY", "2026-10-15", 19, 15)];
const ahclKey = actionKeyOf("AHCL", "DIVIDEND", "2026-10-21", 125);
const shortRow = { ...tx("AHCL", "DIVIDEND", "2026-10-21", 21000, 1.25), _id: "r1", totalAmount: 26250, netAmount: 22312.5, taxDeducted: 3937.5, zakatDeducted: 0, source: "auto", actionKey: ahclKey };
const stale = staleAutoDividends({ liveTxs: [...lateTrade, shortRow] as any, defaultPortfolioId: "p", today: "2026-11-04" });
eq("a late trade: the job's row worked out again", [stale.length, stale[0]?.was, stale[0]?.shares, stale[0]?.gross, stale[0]?.net], [1, 21000, 21019, 26273.75, 22332.69]);
eq("a row already right is left alone", staleAutoDividends({ liveTxs: [...lateTrade, { ...shortRow, shares: 21019 }] as any, defaultPortfolioId: "p", today: "2026-11-04" }).length, 0);
eq("a row typed in is left alone", staleAutoDividends({ liveTxs: [...lateTrade, { ...shortRow, source: "" }] as any, defaultPortfolioId: "p", today: "2026-11-04" }).length, 0);
eq("no shares entitled now: left for the user", staleAutoDividends({ liveTxs: [shortRow] as any, defaultPortfolioId: "p", today: "2026-11-04" }).length, 0);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
