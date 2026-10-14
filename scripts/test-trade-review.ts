// Looking back at trades: the sale review (lib/analytics/sale-review), the
// reasons typed on trades shown back at three months and a year
// (lib/notes/reminders) and the June tax check (lib/tax/june).
//
//   npx tsx scripts/test-trade-review.ts

import { reviewSale } from "../lib/analytics/sale-review";
import { addMonths, dueNotes, isReason, noteMessage } from "../lib/notes/reminders";
import { juneDue, juneMessage } from "../lib/tax/june";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}
const near = (a: number | null | undefined, b: number, tol = 1e-6) => a != null && Math.abs(a - b) < tol;

// 3,000 PTL sold at 48 for 143,500 after fees.
const sale = { id: "s1", symbol: "PTL", date: "2026-10-13", shares: 3000, price: 48, proceeds: 143500 };
const closes = [{ date: "2026-10-12", close: 49 }, { date: "2026-10-13", close: 48.2 }, { date: "2026-11-20", close: 53.02 }];
const r = reviewSale(sale, closes, { date: "2026-11-20", close: 53.02 }, [{ bookClosure: "2026-10-14", dps: 2 }, { bookClosure: "2027-03-25", dps: 2 }], 15);
check("worth now: the sale's value moved by the close-to-close change since", near(r.worthNow, 3000 * 48 * (53.02 / 48.2)) && near(r.changePct, (53.02 / 48.2 - 1) * 100), r.worthNow?.toFixed(0));
check("a dividend booked the day after the sale was yours: not counted, and one not yet booked neither", near(r.dividends, 0));
check("selling cost: what the sale brought in less what the shares and dividends are worth now", near(r.diff, 143500 - 3000 * 48 * (53.02 / 48.2)), r.diff?.toFixed(0));
const early = reviewSale({ ...sale, date: "2026-10-05" }, [{ date: "2026-10-05", close: 48 }, { date: "2026-11-20", close: 48 }], { date: "2026-11-20", close: 48 }, [{ bookClosure: "2026-10-14", dps: 2 }], 15);
check("sold before the book closure: the dividend would have been the shares', after tax", near(early.dividends, 2 * 3000 * 0.85) && near(early.diff, 143500 - 144000 - 5100));
const bonus = reviewSale({ ...sale, date: "2026-01-10" }, [{ date: "2026-01-10", close: 40 }, { date: "2026-11-20", close: 44 }], { date: "2026-11-20", close: 40 }, [], 15);
check("a bonus since: the adjusted series' change, not today's price against the sale's", near(bonus.changePct, 10), bonus.changePct);
const noBars = reviewSale(sale, [], { date: "2026-11-20", close: 50 }, [], 15);
check("no series kept: the latest close against the sale price", near(noBars.changePct, (50 / 48 - 1) * 100));
check("nothing since the sale: no review", reviewSale(sale, [], { date: "2026-10-13", close: 48 }, [], 15).diff === null);

check("reasons, not the app's own notes", isReason("Cheap after results, PE 4") && !isReason("Imported") && !isReason("auto from announcement") && !isReason("ok"));
check("months on, the month end kept", addMonths("2026-01-31", 3) === "2026-04-30" && addMonths("2025-10-14", 12) === "2026-10-14");
const trades = [
  { id: "a", symbol: "PTL", type: "BUY" as const, date: "2026-07-14", price: 62, note: "Tyres demand up, cheap" },
  { id: "b", symbol: "MEBL", type: "SELL" as const, date: "2025-10-10", price: 300, note: "Took profit" },
  { id: "c", symbol: "AHCL", type: "BUY" as const, date: "2026-03-01", price: 14, note: "Imported" },
  { id: "d", symbol: "HUBC", type: "BUY" as const, date: "2025-06-01", price: 150, note: "Old reason" },
];
const due = dueNotes(trades, "2026-10-14");
check("due today: three months on and a year on; an old one past its two weeks is not", due.map((d) => `${d.trade.id}${d.months}`).sort().join() === "a3,b12", due.map((d) => `${d.trade.id}${d.months}`));
check("a note found late still comes within two weeks", dueNotes([trades[0]], "2026-10-27").length === 1 && dueNotes([trades[0]], "2026-10-29").length === 0);
const m = noteMessage(trades[0], 3, { price: 49.1, changePct: -20.8 });
check("the message: when, what, the reason and the price since", m.includes("3 months ago you bought <b>PTL</b> at 62.00") && m.includes("“Tyres demand up, cheap”") && m.includes("Now 49.10, −20.8%: the buy is behind"), m);
check("a sale that kept rising says so", noteMessage(trades[1], 12, { price: 560, changePct: 86.7 }).includes("it has risen since you sold"));

check("the June check is due from 1 to 29 June", juneDue("2027-06-01") && juneDue("2027-06-29") && !juneDue("2027-06-30") && !juneDue("2027-05-31"));
const j = juneMessage({ label: "FY26-27", netGain: 42000, cgt: 6300, ratePct: 15, dividendsNet: 30000, dividendTax: 5300, losers: [{ symbol: "PTL", open: -904, parked: false }, { symbol: "LUCK", open: -387, parked: true }, { symbol: "MEBL", open: 0.4, parked: false }] }, "https://x/portfolio?tab=cgt");
check("June: gains and CGT, dividends, the shares under cost biggest loss first, and that a loss counts", j.includes("Gains booked: Rs 42,000 net, CGT Rs 6,300 at 15%") && j.includes("Under cost: PTL −Rs 904, LUCK (parked) −Rs 387; −Rs 1,291 in all") && j.includes("set against this year's gains") && !j.includes("MEBL"), j);
check("June with nothing under cost says so", juneMessage({ label: "FY26-27", netGain: -500, cgt: 0, ratePct: 15, dividendsNet: 0, dividendTax: 0, losers: [] }, "x").includes("No share is under cost"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
