// Sector P/E, dividend yields and fair P/E (lib/fair-pe/calc), and the
// dividend record read from the closing files (lib/quant/sheet-events).
//
//   npx tsx scripts/test-fair-pe.ts

import { aggregate, buildHistory, cashIn, cpiYoy, eyAt, fairOf, fitOf, profitAt, rateOf, shareFair, yearEnd, type CompanyInput, type SectorHistory } from "../lib/fair-pe/calc";
import { eventsFromSheets } from "../lib/quant/sheet-events";
import type { DayRow } from "../lib/timeseries/psx-history";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}
const near = (a: number | null | undefined, b: number, tol = 1e-6) => a != null && Math.abs(a - b) < tol;

check("fiscal years end on the month's last day", yearEnd(2025, 6) === "2025-06-30" && yearEnd(2024, 12) === "2024-12-31" && yearEnd(2024, 2) === "2024-02-29");

const june: Pick<CompanyInput, "annual" | "fyEndMonth"> = { fyEndMonth: 6, annual: [{ fiscalYear: 2024, profit: 80 }, { fiscalYear: 2025, profit: 100 }] };
const dec: Pick<CompanyInput, "annual" | "fyEndMonth"> = { fyEndMonth: 12, annual: [{ fiscalYear: 2023, profit: 50 }, { fiscalYear: 2024, profit: 60 }, { fiscalYear: 2025, profit: 70 }] };
check("a June year's profit counts at its own 30 June", profitAt(june, "2025-06-30") === 100 && profitAt(june, "2025-06-29") === 80);
check("a December year: the last one ended before the date", profitAt(dec, "2025-06-30") === 60 && profitAt(dec, "2026-01-05") === 70);
check("a profit more than 15 months old is not used", profitAt(june, "2026-12-31") === null);

const cash = { cash: [{ date: "2024-06-30", cash: 1 }, { date: "2024-07-01", cash: 2 }, { date: "2025-06-30", cash: 3 }, { date: "2025-07-01", cash: 9 }] };
check("dividends of the 12 months to the date", cashIn(cash, "2025-06-30") === 5);

const agg = aggregate([
  { value: 1000, profit: 100, dy: 5 },
  { value: 500, profit: 100, dy: 10 },
  { value: 500, profit: -50, dy: 0 },
]);
check("sector P/E: the profitable companies' value over their profit", near(agg.pe, 1500 / 200) && agg.profitable === 2 && agg.companies === 3, agg);
check("dividend yield weighted by value, loss-makers included", near(agg.dy, (5 * 1000 + 10 * 500 + 0) / 2000));
check("payout: the dividends over the profit", near(agg.payout, (50 + 50) / 200));
check("one profitable company is not a sector P/E", aggregate([{ value: 1000, profit: 100, dy: 5 }, { value: 300, profit: -1, dy: 0 }]).pe === null);
check("profit figures for under 60% of the value: no P/E", aggregate([{ value: 300, profit: 30, dy: 0 }, { value: 300, profit: 20, dy: 0 }, { value: 1000, profit: null, dy: 0 }]).pe === null && near(aggregate([{ value: 700, profit: 30, dy: 0 }, { value: 300, profit: 20, dy: 0 }, { value: 400, profit: null, dy: 0 }]).pe, 20));

// Two banks and a cement maker. Bank A had a 2-for-1 split after 2024: its
// adjusted close then is half the actual one, and today's shares are twice
// the shares then, so the value then is the same.
const bankA: CompanyInput = {
  symbol: "BA", sector: "Banks", shares: 200, fyEndMonth: 12,
  annual: [{ fiscalYear: 2023, profit: 1000 }, { fiscalYear: 2024, profit: 1200 }, { fiscalYear: 2025, profit: 1500 }],
  at: { "2024-06-30": { adj: 20, actual: 40 }, "2025-06-30": { adj: 30, actual: 30 } },
  priceNow: 36,
  cash: [{ date: "2023-09-01", cash: 4 }, { date: "2024-09-01", cash: 3 }],
};
const bankB: CompanyInput = {
  symbol: "BB", sector: "Banks", shares: 100, fyEndMonth: 12,
  annual: [{ fiscalYear: 2023, profit: 500 }, { fiscalYear: 2024, profit: 600 }, { fiscalYear: 2025, profit: 700 }],
  at: { "2024-06-30": { adj: 25, actual: 25 }, "2025-06-30": { adj: 40, actual: 40 } },
  priceNow: 42,
  cash: [{ date: "2025-03-01", cash: 2 }],
};
const cem: CompanyInput = {
  symbol: "CM", sector: "Cement", shares: 50, fyEndMonth: 6,
  annual: [{ fiscalYear: 2024, profit: 100 }, { fiscalYear: 2025, profit: 120 }],
  at: { "2024-06-30": { adj: 20, actual: 20 }, "2025-06-30": { adj: 30, actual: 30 } },
  priceNow: 33,
  cash: [],
};
const dates = ["2024-06-30", "2025-06-30"];
const h = buildHistory([bankA, bankB, cem], dates, "2025-10-20");
const banks = h.sectors.find((s) => s.sector === "Banks")!;
check("value then = today's shares × the adjusted close (a split counts once)", near(banks.years["2024-06-30"].value, 200 * 20 + 100 * 25));
check("banks' P/E at 30 June 2024: on their 2023 profits", near(banks.years["2024-06-30"].pe, (4000 + 2500) / 1500));
check("dividend yield against the actual price then", near(banks.years["2024-06-30"].dy, ((4 / 40) * 100 * 4000 + 0 * 2500) / 6500));
check("now (20 Oct 2025): the latest price and the last full year, 2024 for a December year", near(banks.now.pe, (200 * 36 + 100 * 42) / (1200 + 600)));
check("a sector with one company has no P/E", h.sectors.find((s) => s.sector === "Cement")!.years["2025-06-30"].pe === null);
check("all covered: every company", h.all.years["2025-06-30"].companies === 3 && h.all.years["2025-06-30"].profitable === 3);
check("sectors largest first", h.sectors[0].sector === "Banks");

// Two years: premiums 12.5 − 10 = 2.5 and 10 − 6 = 4 over the T-bill; too few
// for a line, so the yield moves point for point from the median premium.
const pt = (pe: number) => ({ pe, dy: 5, payout: 0.5, value: 1, companies: 2, profitable: 2, covered: 1 });
const sector: SectorHistory = { sector: "S", years: { "2024-06-30": { ...pt(8), dy: 6, payout: 0.5 }, "2025-06-30": { ...pt(10), payout: 0.6 } }, now: { ...pt(9), dy: 5.5, payout: null } };
const yrs = { "2024": { tbill: 10 }, "2025": { tbill: 6 } };
const f = fairOf(sector, dates, yrs, 8);
check("premiums: earnings yield over each year's rate", f.premiums.length === 2 && near(f.premiums[0].premium, 2.5) && near(f.premiums[1].premium, 4));
check("two years: the yield moves point for point from the median premium", f.fit?.b === 1 && near(f.fit.a, 3.25) && near(f.fairPe, 100 / 11.25), f.fit);
check("the range from the line's largest miss", near(f.fairPeLow, 100 / 12) && near(f.fairPeHigh, 100 / 10.5));
check("fair dividend yield = fair earnings yield × usual payout", near(f.fairDy, 11.25 * 0.55));
check("extra risk lowers the fair P/E", near(fairOf(sector, dates, yrs, 8, 2).fairPe, 100 / 13.25));
check("no rate for now: no fair P/E", fairOf(sector, dates, yrs, null).fairPe === null);
check("the policy rate stands in for a missing T-bill", rateOf({ policy: 11 }) === 11 && rateOf({ tbill: 12, policy: 11 }) === 12 && rateOf({}) === null);
check("no year with a rate: no line", fairOf(sector, dates, {}, 8).fit === null);

// Four years. A rate-sensitive sector, earnings yield = 5 + 1.5 × rate, and a
// rate-blind one, its yield 6 whatever the rate.
const four = ["2023-06-30", "2024-06-30", "2025-06-30", "2026-06-30"];
const rates4 = { "2023": { tbill: 18 }, "2024": { tbill: 14 }, "2025": { tbill: 10 }, "2026": { tbill: 6 } };
const sectorOn = (ey: (r: number) => number): SectorHistory => ({ sector: "X", years: Object.fromEntries(four.map((d) => [d, pt(100 / ey(rates4[d.slice(0, 4) as "2023"].tbill))])), now: pt(9) });
const steep = fitOf(sectorOn((r) => 5 + 1.5 * r), four, rates4)!;
check("a line through the years: 1.5 points of yield per point of rate", near(steep.b, 1.5) && near(steep.a, 5) && near(steep.miss, 0) && steep.years === 4, steep);
check("inside the rates seen: on the line", near(eyAt(steep, 12), 23));
check("beyond them: point for point", near(eyAt(steep, 20), 5 + 1.5 * 18 + 2) && near(eyAt(steep, 4), 5 + 1.5 * 6 - 2));
const blind = fitOf(sectorOn(() => 6), four, rates4)!;
check("a rate-blind sector keeps its P/E at any rate", near(blind.b, 0) && near(eyAt(blind, 25), 6) && near(eyAt(blind, 3), 6));
check("a yield that fell as rates rose is read as rate-blind, not the other way", fitOf(sectorOn((r) => 30 - r), four, rates4)!.b === 0);
check("a year left out is not in the line", fitOf(sectorOn((r) => 5 + 1.5 * r), four, rates4, ["2023", "2024"])!.years === 2);

const co = { symbol: "C", sector: "S", years: { "2024-06-30": { pe: 12, dy: 4 }, "2025-06-30": { pe: 13, dy: 3 } }, now: { pe: 11, dy: 3.5 } };
const sf = shareFair(co, sector, dates, 9);
check("a share's fair P/E: its usual P/E against the sector × the sector's fair", near(sf.ratio, 1.4) && near(sf.fairPe, 12.6), sf);
check("a share with one year against its sector: no fair P/E", shareFair({ ...co, years: { "2025-06-30": { pe: 13, dy: 3 } } }, sector, dates, 9).fairPe === null);

check("CPI year on year from the monthly index", near(cpiYoy([{ period: "2025-06", index: 110 }, { period: "2024-06", index: 100 }], "2025-06"), 10) && cpiYoy([{ period: "2025-06", index: 110 }], "2025-06") === null);

// The closing files: a Rs 5 dividend on a Rs 100 share, a 25% bonus, a
// day after an unknown weekday, a change too small to be an action.
const row = (s: string, close: number, ldcp: number): DayRow => [s, close, close, close, close, 1000, ldcp];
const sheets = [
  { date: "2026-10-12", rows: [row("AAA", 100, 100), row("BBB", 125, 125), row("CCC", 50, 50), row("DDD", 80, 80)] },
  { date: "2026-10-13", rows: [row("AAA", 96, 95), row("BBB", 101, 100), row("CCC", 50, 49.9), row("DDD", 80, 80)] },
  { date: "2026-10-15", rows: [row("AAA", 97, 96), row("DDD", 70, 70)] },
];
const ev = eventsFromSheets(sheets, new Set(["2026-10-12", "2026-10-13", "2026-10-15"]));
const a = ev.find((e) => e.symbol === "AAA" && e.date === "2026-10-13");
check("a cash dividend: the close before less the LDCP, with its yield", a?.kind === "cash" && near(a.cash, 5) && near(a.yieldPct, 5), a);
check("a 25% bonus", ev.some((e) => e.symbol === "BBB" && e.kind === "bonus" && Math.abs(e.ratioPct - 25) < 0.2), ev.filter((e) => e.symbol === "BBB"));
check("a move inside half a percent is no action", !ev.some((e) => e.symbol === "CCC"));
check("after an unknown weekday nothing is read", !ev.some((e) => e.date === "2026-10-15"), ev.map((e) => `${e.symbol} ${e.date}`));
check("a known holiday in between is fine", eventsFromSheets(sheets, new Set(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"])).some((e) => e.symbol === "DDD" && e.date === "2026-10-15"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
