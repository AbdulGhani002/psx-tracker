// Checks for the automatic dividend and bonus recording (lib/corporate-actions).
//   npx tsx scripts/test-corporate-actions.ts
import { businessDaysBefore, lastEntitledTradeDate, sharesEntitled, dividendFigures, bonusFigures, planDueActions, financialYearLabel, actionKeyOf, type AutoSettings } from "../lib/calculations/corporate-actions";

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
  { symbol: "LUCK", faceValue: 10, payouts: [{ date: "2026-08-10", bookClosure: "2026-09-18", pctOfFace: 250, cycle: "F", payoutType: "cash" }, { date: "2025-08-11", bookClosure: "2025-09-19", pctOfFace: 200, cycle: "F", payoutType: "cash" }] },
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
eq("LUCK shares entitled and figures", luck && [luck.shares, luck.rate, luck.gross, luck.net], [330, 25, 8250, 7012.5]);
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

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
