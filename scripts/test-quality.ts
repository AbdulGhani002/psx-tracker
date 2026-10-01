// Quality and price: the cycle-adjusted P/E, ROE and its DuPont split, the
// quadrant, the grade, the portfolio's weighted figures, and the balance
// sheet read from a filed statement.
//
//   npx tsx scripts/test-quality.ts

import { quality, portfolioQuality, cpiAt, median, dividendsTtm } from "../lib/fundamentals/quality";
import { parseBalanceSheet, statementDate, statementUnit, amountsOf, unitFromCapital, FILED_REPORT } from "../lib/prices/balance-sheet";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}
const near = (a: number | null | undefined, b: number, tol = 0.01) => a != null && Math.abs(a - b) < tol;

// MUREB's four years as the exchange reports them (thousands, EPS in rupees).
const annual = [
  { fiscalYear: 2026, eps: 137.02, profitAfterTax: 3790414, revenue: 31995846, netMarginPct: 11.85, grossMarginPct: 25.14 },
  { fiscalYear: 2025, eps: 117.92, profitAfterTax: 3262051, revenue: 28562599, netMarginPct: 11.42 },
  { fiscalYear: 2024, eps: 94.76, profitAfterTax: 2621355, revenue: 23798244, netMarginPct: 11.01 },
  { fiscalYear: 2023, eps: 46.04, profitAfterTax: 1273689, revenue: 18591183, netMarginPct: 6.85 },
];
// A price index rising 10% a year to June, 136 by September 2026.
const cpi = [
  { period: "2023-06", index: 100 }, { period: "2024-06", index: 110 }, { period: "2025-06", index: 121 },
  { period: "2026-06", index: 133.1 }, { period: "2026-09", index: 136 },
];
const base = { price: 936, shares: 27663631, annual, fiscalYearEndMonth: 6, dividendsTtm: 40, cpi, costOfEquityPct: 17, marketMedianCape: 10 };
const q = quality({ ...base, balance: { periodEnd: "2026-06-30", equity: 20767e6, totalAssets: 26280e6 }, manualBvps: null });

check("the P/E is price over the latest annual EPS", near(q.pe, 936 / 137.02));
const real = [137.02 * 136 / 133.1, 117.92 * 136 / 121, 94.76 * 136 / 110, 46.04 * 136 / 100];
check("each year's EPS is restated in today's rupees", q.realEps.length === 4 && near(q.realEps[3].real, real[3]));
check("the cycle-adjusted P/E is price over their average", near(q.cape, 936 / (real.reduce((s, v) => s + v, 0) / 4)) && q.capeYears === 4, q.cape?.toFixed(2));
check("ROE is the year's profit over the equity in the statement", near(q.roePct, (3790414e3 / 20767e6) * 100), q.roePct?.toFixed(2));
check("DuPont: margin x turnover x leverage is the same ROE", q.dupont != null && near((q.dupont.netMarginPct / 100) * q.dupont.assetTurnover * q.dupont.equityMultiplier * 100, q.roePct!, 1e-6));
check("book value per share from equity over shares", near(q.bvps, 20767e6 / 27663631) && q.bookSource === "statement" && near(q.pb, 936 / (20767e6 / 27663631)));
check("earnings grew at the compound rate between the window's ends", near(q.epsCagrPct, (Math.pow(137.02 / 46.04, 1 / 3) - 1) * 100));
check("dividend yield and payout from the last twelve months' dividends", near(q.dividendYieldPct, (40 / 936) * 100) && near(q.payoutPct, (40 / 137.02) * 100));
check("above its cost of equity and below the market's multiple: a compounder", q.quadrant === "compounder");
check("ROE over its cost with steady growing earnings, but not five points over: grade B", q.grade === "B", q.grade);
const g = Math.min(q.roePct! * (1 - q.payoutPct! / 100), 17 - 2, 12);
check("justified P/B from ROE, growth and the cost of equity", near(q.justifiedPb, (q.roePct! - g) / (17 - g)));
check("the cycle-adjusted earnings yield is one over the CAPE", near(q.capeYieldPct, 100 / q.cape!));
const sg = q.roePct! * (1 - q.payoutPct! / 100);
check("implied return: dividend yield plus ROE times the share kept", near(q.sustainableGrowthPct, sg) && near(q.impliedReturnPct, (40 / 936) * 100 + sg), q.impliedReturnPct?.toFixed(2));

const manual = quality({ ...base, balance: null, manualBvps: 750 });
check("without a statement the holding's own book value is used", manual.bookSource === "manual" && near(manual.roePct, (137.02 / 750) * 100) && manual.dupont === null);
const none = quality({ ...base, balance: null, manualBvps: null });
check("with neither, no ROE, no grade, and a note saying how to add one", none.roePct === null && none.grade === null && none.notes.some((n) => /book value per share/.test(n)));
const bad = quality({ ...base, balance: { periodEnd: "2026-06-30", equity: 20767e3, totalAssets: 26280e3 }, manualBvps: null });
check("a book value a thousand times off is set aside, not used", bad.pb === null && bad.roePct === null && bad.notes.length > 0);
const dear = quality({ ...base, balance: { periodEnd: "2026-06-30", equity: 20767e6, totalAssets: 26280e6 }, manualBvps: null, marketMedianCape: 5 });
check("the same company priced above the market's multiple is quality at a premium", dear.quadrant === "premium");
const poor = quality({ ...base, balance: { periodEnd: "2026-06-30", equity: 60000e6, totalAssets: 70000e6 }, manualBvps: null });
check("earning less than its cost of equity and cheap: a possible value trap", poor.quadrant === "trap" && poor.roePct! < 17);

check("the price index at a year's end, or the nearest month within three", cpiAt(cpi, 2025, 6) === 121 && cpiAt(cpi, 2026, 8) === 136 && cpiAt(cpi, 2020, 6) === null);
check("the median", median([3, 1, 2]) === 2 && median([4, 1, 3, 2]) === 2.5 && median([]) === null);

const port = portfolioQuality([{ value: 600, q: { ...q, pe: 6 } }, { value: 400, q: { ...dear, pe: 12, quadrant: "premium" } }]);
check("the portfolio P/E is value over earnings (harmonic), not the average P/E", near(port.pe, 1000 / (600 / 6 + 400 / 12)), port.pe?.toFixed(3));
check("the portfolio's cycle-adjusted yield is one over its (harmonic) CAPE", port.capeYieldPct != null && near(port.capeYieldPct, 100 / port.cape!));
check("the share of value in each quadrant", near(port.quadrants.compounder, 0.6) && near(port.quadrants.premium, 0.4));

// Dividends over the last twelve months.
const pays = [
  { date: "2026-09-20", pctOfFace: 150, cycle: "F", payoutType: "cash" },
  { date: "2026-02-10", pctOfFace: 50, cycle: "i", payoutType: "cash" },
  { date: "2025-10-05", pctOfFace: 120, cycle: "F", payoutType: "cash" },
  { date: "2026-03-01", pctOfFace: 10, cycle: "", payoutType: "bonus" },
  { date: "2025-06-01", pctOfFace: 80, cycle: "ii", payoutType: "cash" },
];
check("twelve months of cash dividends, each cycle once (the newest final)", near(dividendsTtm(pays, 10, "2026-10-01"), 15 + 5), dividendsTtm(pays, 10, "2026-10-01"));
check("bonus issues and payouts older than a year are not cash dividends", near(dividendsTtm(pays.slice(3), 10, "2026-10-01"), 0));
check("no payout history at all is unknown, not zero", dividendsTtm([], 10, "2026-10-01") === null);
check("the face value scales the percentage", near(dividendsTtm([{ date: "2026-05-01", pctOfFace: 40, cycle: "F" }], 5, "2026-10-01"), 2));

// The statement reader, on the shapes the exchange's filings take.
check("statement dates in their several forms", statementDate("As at 31 March 2026") === "2026-03-31" && statementDate("AS AT JUNE 30, 2026") === "2026-06-30" && statementDate("as at 30.06.2026") === "2026-06-30" && statementDate("As at 31st December 2025") === "2025-12-31");
check("units: rupees, thousands, millions", statementUnit(["(Rupees)"]) === 1 && statementUnit(["(Rupees in '000)"]) === 1000 && statementUnit(["Rupees in 000"]) === 1000 && statementUnit(["Rs. in million"]) === 1000000 && statementUnit(["(2025: 168,000,000) shares"]) === 1);
check("amounts, brackets negative", JSON.stringify(amountsOf("TOTAL EQUITY 67,800,921,654 (54,892)")) === JSON.stringify([67800921654, -54892]));
const twoPage = [
  ["CONDENSED INTERIM UNCONSOLIDATED", "STATEMENT OF FINANCIAL POSITION", "As at 31 March 2026", "--------------(Rupees)--------------", "ASSETS", "TOTAL ASSETS 78,010,696,658 66,291,797,015"],
  ["CONDENSED INTERIM UNCONSOLIDATED", "STATEMENT OF FINANCIAL POSITION", "As at 31 March 2026", "EQUITY AND LIABILITIES", "TOTAL EQUITY 67,800,921,654 54,892,905,916", "TOTAL LIABILITIES 10,209,775,004 11,398,891,099", "TOTAL EQUITY AND LIABILITIES 78,010,696,658 66,291,797,015"],
];
const bs1 = parseBalanceSheet(twoPage);
check("a two-page statement: total equity from the facing page", bs1 != null && bs1.equity === 67800921654 && bs1.totalAssets === 78010696658 && bs1.periodEnd === "2026-03-31" && !bs1.consolidated);
const subtotal = [["UNCONSOLIDATED CONDENSED INTERIM STATEMENT OF FINANCIAL POSITION", "AS AT JUNE 30, 2026", "Rupees Rupees", "TOTAL ASSETS 68,018,033,259 52,040,557,875", "EQUITY AND LIABILITIES", "Share capital and reserves", "Issued, subscribed and paid-up share capital 2,946,808,869 2,946,808,869", "Revenue reserve 30,527,652,820 30,013,914,860", "50,632,847,155 40,105,446,920", "Non-current liabilities", "Lease liabilities 364,114,870 285,832,136"]];
const bs2 = parseBalanceSheet(subtotal);
check("an unlabelled subtotal closing the share capital and reserves", bs2 != null && bs2.equity === 50632847155);
const bank = [["UNCONSOLIDATED CONDENSED INTERIM", "STATEMENT OF FINANCIAL POSITION", "AS AT JUNE 30, 2026", "Rupees in 000", "Total Assets 5,142,014,249 4,806,560,919", "Total Liabilities 4,853,357,764 4,527,303,796", "NET ASSETS"]];
const bs3 = parseBalanceSheet(bank);
check("a bank whose net assets line has no figures: assets less liabilities, in thousands", bs3 != null && bs3.equity === (5142014249 - 4853357764) * 1000 && bs3.method === "assets-less-liabilities");
const consolOnly = [["CONDENSED INTERIM CONSOLIDATED STATEMENT OF FINANCIAL POSITION", "AS AT MARCH 31, 2026", "(Rupees in thousand)", "TOTAL EQUITY 291,427,502 273,898,799", "TOTAL ASSETS 472,176,080 425,458,133"]];
const bs4 = parseBalanceSheet(consolOnly);
check("a consolidated statement is marked as such", bs4 != null && bs4.consolidated && bs4.equity === 291427502000);
check("thousands written Rs. '000s", statementUnit(["(Rs. '000s) (Rs. '000s)"]) === 1000 && statementUnit(["(Rs. ‘000s)"]) === 1000);
const group = [
  ["CONSOLIDATED STATEMENT OF", "FINANCIAL POSITION", "AS AT JUNE 30, 2026", "Note 2026 2025", "(Rs. '000s) (Rs. '000s)", "TOTAL ASSETS 422,563,444 414,722,187", "EQUITY AND LIABILITIES", "SHARE CAPITAL AND RESERVES", "Unappropriated profit 212,926,195 198,007,417", "ATTRIBUTABLE TO OWNERS OF THE HOLDING COMPANY 235,381,655 219,708,081", "NON-CONTROLLING INTERESTS 22,625,854 24,213,824", "258,007,509 243,921,905", "NON-CURRENT LIABILITIES", "Long term loans 26 62,943,930 71,824,944", "TOTAL EQUITY AND LIABILITIES 422,563,444 414,722,187"],
  ["CONSOLIDATED STATEMENT OF PROFIT OR LOSS", "FOR THE YEAR ENDED JUNE 30, 2026", "Profit attributable to owners of the holding company 40,112,000 38,000,000"],
];
const bs5 = parseBalanceSheet(group);
check("a group's statement: the owners' equity, without the minority interests", bs5 != null && bs5.equity === 235381655000 && bs5.method === "owners-equity" && bs5.unit === 1000, bs5?.equity);
const noMarker = [["PAKISTAN STATE OIL COMPANY LIMITED", "Condensed Unconsolidated Interim Statement of Financial Position", "As at March 31, 2026", "TOTAL ASSETS 1,140,143,161 1,019,078,036", "EQUITY AND LIABILITIES", "Equity", "Share capital 4,694,734 4,694,734", "Reserves 278,914,377 245,596,457", "283,609,111 250,291,191", "Non-current liabilities"]];
const bs6 = parseBalanceSheet(noMarker, { shares: 469473400 });
check("no unit printed: the share capital against the shares in issue says thousands", bs6 != null && bs6.unit === 1000 && bs6.equity === 283609111000, bs6?.equity);
check("and the capital decides over a misleading marker", unitFromCapital([["(Rupees)", "Issued, subscribed and paid-up capital 12,971,544"]], 1297154400) === 1000 && unitFromCapital([["Share capital 2,946,808,869"]], 294680887) === 1);
check("a capital label run together with another column's figures is not the capital", unitFromCapital([["Issued, subscribed and paid up capital Taxation (433,577,859) 5,027,796 (172,321,570)"]], 168000000) === null);
check("without a share count, the heading decides", parseBalanceSheet(noMarker)?.unit === 1);
check("filed reports in their several titles", FILED_REPORT.test("Transmission of Quarterly Financial Statements for the Period Ended 2026-06-30") && FILED_REPORT.test("Transmission of Annual Report for the Year Ended June 30, 2026") && FILED_REPORT.test("Transmission of Half Yearly Financial Statements for the Period Ended 31-12-2025") && !FILED_REPORT.test("Financial Results for the Year Ended 2026-06-30"));
check("a review report naming the statement is not the statement", parseBalanceSheet([["We have reviewed the accompanying statement of financial position as at June 30, 2026", "Total assets grew 7%"]]) === null);

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
