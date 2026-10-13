// The buy-zone engine (lib/valuation/engine).
//
//   npx tsx scripts/test-valuation.ts

import { hurdle, cappedGrowth, methodValues, blend, sotpValue, value, expectedReturn, rank, signalChanges, firedTriggers, metricsOf, roundLevel, WEIGHTS, type Assumption, type Signal } from "../lib/valuation/engine";
import { parseResultFigures, periodOf, dividendOf } from "../lib/prices/results";
import { draftFrom, draftDiffers, draftSignature, typeOfSector, type DraftInput } from "../lib/valuation/draft";
import { settleFigures, basisOf, scaleOf, type PageRead } from "../lib/valuation/figures";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}
const near = (a: number | null | undefined, b: number, tol = 0.01) => a != null && Math.abs(a - b) < tol;
const none = new Map<string, number>();
const at = (price: number, held = false, stale = false, prices = none) => ({ price, tbillPct: 12.49, held, stale, prices });

// A share valued by one P/E, so its fair value is exactly EPS x multiple.
const byPe = (symbol: string, fair: number, policy: Assumption["policy"], extra: Partial<Assumption> = {}): Assumption => ({ symbol, type: "operating", policy, governance: "green", eps: fair / 10, dps: null, bvps: null, roe: null, g: 0, pe: 10, weights: { ddm: 0, ep: 0, pe: 1 }, ...extra });
// A holding company valued at its NAV alone.
const byNav = (symbol: string, nav: number, policy: Assumption["policy"]): Assumption => ({ symbol, type: policy === "shell" ? "shell" : "holdco", policy, governance: "green", eps: null, dps: null, bvps: null, roe: null, g: 0, sotp: { parts: [{ label: "book", kind: "unlisted", value: nav * 1000 }], netDebt: 0, discount: 0, shares: 1000 } });

// --- the hurdle and growth -------------------------------------------------------
check("r = T-bill + 3.5 for a quality name, + 4.5 for the rest", near(hurdle(12.49, { policy: "quality" }), 15.99) && near(hurdle(12.49, { policy: "standard" }), 16.99) && near(hurdle(12.49, { policy: "quality", premium: 5 }), 17.49));
check("growth held to ROE x retention", near(cappedGrowth({ g: 12, roe: 15, eps: 10, dps: 6 }, 16), 6));
check("and to four points under r", near(cappedGrowth({ g: 15, roe: 30, eps: 10, dps: 0 }, 16), 12));
check("an ROE under the hurdle keeps growth low", near(cappedGrowth({ g: 5, roe: 9, eps: 10, dps: 5 }, 17), 4.5));

// --- the methods -------------------------------------------------------------------
const bank: Assumption = { symbol: "BANK", type: "bank", policy: "quality", governance: "green", eps: 15, dps: 10, bvps: 100, roe: 15, g: 6 };
const mv = methodValues(bank, 16, 6, none);
check("dividend discount D1 / (r - g)", near(mv.ddm, 100));
check("justified P/B, BVPS x (ROE - g) / (r - g)", near(mv.pb, 90));
check("earnings power, EPS x (1 - g/ROE) / (r - g)", near(mv.ep, 90));
check("P/E from a multiple, or moving with rates", near(methodValues({ ...bank, pe: 7 }, 16, 6, none).pe, 105) && near(methodValues({ ...bank, peSpread: 4 }, 16, 6, none).pe, 125) && methodValues(bank, 16, 6, none).pe === null);
check("a bank blends DDM, P/B and earnings power equally", near(blend(mv, WEIGHTS.bank), (100 + 90 + 90) / 3));
check("weights rescale over the methods that gave a value", near(blend({ ddm: 100, pb: null, ep: 80, pe: null, sotp: null }, { ddm: 1, pb: 1, ep: 2 }), 260 / 3));
const parts = { parts: [{ label: "stake", kind: "listed" as const, symbol: "XYZ", shares: 1000, haircut: 0.2 }, { label: "land", kind: "unlisted" as const, value: 10000 }], netDebt: 5000, discount: 0.1, shares: 1000 };
check("sum of the parts at the day's marks, less debt and the discount", near(sotpValue(parts, new Map([["XYZ", 50]])), 40.5) && sotpValue(parts, none) === null, sotpValue(parts, new Map([["XYZ", 50]])));
check("a method that comes out negative gives nothing", methodValues({ ...bank, roe: 4 }, 16, 6, none).pb === null);

// --- the zones of the 12 October table, from its fair values ---------------------------
const z = (a: Assumption) => value(a, at(1000)).zones;
check("MCB, quality, fair 326: accumulate 326, strong 300, trim 440", JSON.stringify(z(byPe("MCB", 326, "quality"))) === JSON.stringify({ accumulate: 326, strong: 300, trim: 440 }), z(byPe("MCB", 326, "quality")));
check("AICL, standard, fair 111, trim at 1.15: 98, 89, 128", JSON.stringify(z(byPe("AICL", 111, "standard", { margins: { trim: 1.15 } }))) === JSON.stringify({ accumulate: 98, strong: 89, trim: 128 }));
check("DGKC, standard, fair 199: 175, 159, 239", JSON.stringify(z(byPe("DGKC", 199, "standard"))) === JSON.stringify({ accumulate: 175, strong: 159, trim: 239 }));
check("NML, holding company, NAV 201.4: 105, 91, 151", JSON.stringify(z(byNav("NML", 201.4, "holdco"))) === JSON.stringify({ accumulate: 105, strong: 91, trim: 151 }), z(byNav("NML", 201.4, "holdco")));
check("LPL, cash shell, NAV 40: 18, 16, 30", JSON.stringify(z(byNav("LPL", 40, "shell"))) === JSON.stringify({ accumulate: 18, strong: 16, trim: 30 }), z(byNav("LPL", 40, "shell")));
check("levels rounded: rupees from 10 up, paisa under", roundLevel(326.4) === 326 && roundLevel(9.876) === 9.88);

// --- the expected return -----------------------------------------------------------------
const aicl = byPe("AICL", 111, "standard", { dps: 6, valueGrowth: 11.2 });
const er = expectedReturn(aicl, 111, 95, 0);
check("cash yield + value growth + the gap closing over three years", near(er.yield, 6.316) && near(er.growth, 11.2) && near(er.rerate, (Math.pow(111 / 95, 1 / 3) - 1) * 100) && near(er.total, er.yield + er.growth + er.rerate), er);
const nav = byNav("NML", 201, "holdco");
check("a holding company re-rates only to a 40% discount, and never down", near(expectedReturn(nav, 201, 100, 0).rerate, (Math.pow(120.6 / 100, 1 / 3) - 1) * 100) && expectedReturn(nav, 201, 150, 0).rerate === 0);

// --- signals and gates -----------------------------------------------------------------------
const mcb = byPe("MCB", 326, "quality", { dps: 30, valueGrowth: 6 });
const sig = (a: Assumption, price: number, held = false, stale = false): Signal => value(a, at(price, held, stale)).signal;
check("at or under the strong zone: strong; under accumulate: accumulate", sig(mcb, 295) === "STRONG" && sig(mcb, 320) === "ACCUMULATE");
check("over the zones: wait, or hold when held; trim when held over the trim level", sig(mcb, 360) === "WAIT" && sig(mcb, 360, true) === "HOLD" && sig(mcb, 450, true) === "TRIM" && sig(mcb, 450) === "WAIT");
check("amber: confirm first, at any zone", sig({ ...mcb, governance: "amber" }, 295) === "CONFIRM" && sig({ ...mcb, governance: "amber" }, 360, true) === "HOLD");
check("red: no buy signal at any price", sig({ ...mcb, governance: "red" }, 100) === "AVOID");
check("stale: a buy signal waits for the review; hold and trim stand", sig(mcb, 295, false, true) === "STALE" && sig(mcb, 450, true, true) === "TRIM");
check("thin: watched, not zoned", sig({ ...mcb, illiquid: true }, 295) === "WATCH");
check("no method gives a value: no value", value({ ...mcb, eps: null }, at(300)).signal === "NO VALUE");
const v1 = value(mcb, at(320));
const vb = value(bank, at(90));
check("the band: fair value at r + 1 and r - 1, for methods that move with rates", vb.band != null && vb.band[0] < vb.fairValue! && vb.band[1] > vb.fairValue!, vb.band);
check("a fixed multiple does not move with rates", v1.band != null && v1.band[0] === v1.band[1]);
check("excess = expected return less the hurdle", near(v1.excess, v1.expected!.total - v1.r));
check("the zone is checked against the hurdle", v1.gates.zoneClears === v1.expected!.atZone! >= v1.r);
const split = value({ ...bank, symbol: "SPLIT", bvps: 300 }, at(80));
check("methods far apart are noted", split.notes.some((n) => n.startsWith("The methods disagree")) && !value(bank, at(80)).notes.some((n) => n.startsWith("The methods disagree")), split.notes);

// --- ranking, changes, triggers ---------------------------------------------------------------
const ranked = rank([value(mcb, at(360)), value({ ...mcb, symbol: "A" }, at(295)), value({ ...mcb, symbol: "R", governance: "red" }, at(200)), value({ ...mcb, symbol: "B" }, at(320))]);
check("ranked: strong, accumulate, wait, avoid", ranked.map((v) => v.symbol).join(",") === "A,B,MCB,R", ranked.map((v) => `${v.symbol} ${v.signal}`));
check("a signal that moved is found; a new name is not a change", JSON.stringify(signalChanges(new Map([["MCB", "WAIT"], ["A", "STRONG"]]), [value(mcb, at(320)), value({ ...mcb, symbol: "A" }, at(295)), value({ ...mcb, symbol: "NEW" }, at(1))])) === JSON.stringify([{ symbol: "MCB", from: "WAIT", to: "ACCUMULATE" }]));
const ins: Assumption = { ...byPe("INS", 111, "standard"), bvps: 120, metrics: { combinedRatio: 103 } };
const m = metricsOf(ins, value(ins, at(110)));
const fired = firedTriggers(
  [
    { id: "1", symbol: "INS", metric: "pb", op: ">=", threshold: 0.9, action: "trim" },
    { id: "2", symbol: "INS", metric: "combinedRatio", op: ">", threshold: 100, action: "exit" },
    { id: "3", symbol: "INS", metric: "pe", op: "<", threshold: 5, action: "buy" },
    { id: "4", symbol: "INS", metric: "unknown", op: ">", threshold: 0, action: "review" },
  ],
  m
);
check("triggers fire on price-based and filing figures; unknown figures do not", fired.map((t) => t.id).join(",") === "1,2", { pb: m.pb, pe: m.pe });

// --- a results filing's figures ------------------------------------------------------------
const letter = [[
  "The Board of Directors in its meeting held on August 28, 2026 approved the annual audited financial statements",
  "for the year ended June 30, 2026. The financial results are as follows:",
  "(Rupees in '000) 2026 2025",
  "Revenue 45,210,330 39,882,104",
  "Profit after taxation 12 6,104,227 4,950,113",
  "Earnings per share - basic and diluted (Rupees) 28 13.25 10.74",
  "The Board has recommended a final cash dividend of Rs. 5.50 per share i.e. 55% for the year.",
  "This is a placeholder line long enough to look like a real letter with text in it, which it is.",
]];
const rf = parseResultFigures(letter);
check("a results letter: the year and its end, EPS past the note, profit in rupees, the cash dividend", rf.period === "year" && rf.periodEnd === "2026-06-30" && rf.eps === 13.25 && rf.profit === 6_104_227_000 && rf.dps === 5.5 && rf.text, rf);
check("a dividend given as a percent of a Rs 10 share", parseResultFigures([[...letter[0].slice(0, 6), "a final cash dividend @ 30% has been recommended for the half year.", letter[0][7]]]).dps === 3);
check("periods: half year, quarter, nine months; day first or month first", periodOf("for the half year ended 31st December 2025").periodEnd === "2025-12-31" && periodOf("Half Year ended December 31, 2025").period === "half year" && periodOf("for the quarter ended September 30, 2026").period === "quarter" && periodOf("nine months ended March 31, 2026").period === "nine months");
check("a scanned filing has no text to read", !parseResultFigures([["", " "]]).text && parseResultFigures([["", " "]]).eps === null);
check("dividends: the restated rupees after a percent of a Re 1 share, not the face value, not an investee's", dividendOf("The Board has recommended declaration of a final Cash Dividend for the year ended 30th June 2026 at 125 % of the face value of Re.1/- per share i.e. Rs.1.25. Fatima: The Board proposed a final cash dividend of PKR 12.50 per share i.e, 125%") === 1.25);
check("dividends: rupees first, then the percent; the first declaration counts", dividendOf("Final cash dividend at Rs. 3.5 per share i.e. 35%, this is in addition to interim dividend of Rs. 2.0 per share i.e. 20%.") === 3.5 && dividendOf("a final cash dividend @ 30% for the half year; face value of Rs. 5 each") === 1.5);
check("a loss per share in brackets", parseResultFigures([[...letter[0].slice(0, 5), "Loss / earnings per share (Rupees) (2.40) 1.10", "Earnings per share (Rupees) (2.40) 1.10", letter[0][7]]]).eps === -2.4);

// --- drafts from the record ----------------------------------------------------------------------
const base: DraftInput = {
  symbol: "XYZ",
  sector: "CEMENT",
  grade: "B",
  thin: false,
  annual: [
    { fiscalYear: 2023, eps: null, profitAfterTax: 8_000_000 },
    { fiscalYear: 2024, eps: null, profitAfterTax: 9_000_000 },
    { fiscalYear: 2025, eps: null, profitAfterTax: 10_000_000 },
  ],
  sharesNow: 1_000_000_000,
  fiscalYearEndMonth: 6,
  equity: 80_000_000_000,
  equityAt: "2026-06-30",
  cashDividends: [{ date: "2025-10-20", cash: 3 }, { date: "2026-03-01", cash: 2 }, { date: "2024-09-01", cash: 9 }],
  today: "2026-10-12",
  previous: null,
};
const d1 = draftFrom(base);
check("EPS on today's shares, the year's dividends, book value and ROE", d1.eps === 10 && d1.dps === 5 && d1.bvps === 80 && d1.roe === 12.5, { eps: d1.eps, dps: d1.dps, bvps: d1.bvps, roe: d1.roe });
check("growth from the EPS trend, at most 10%", d1.g === 10 && draftFrom({ ...base, annual: base.annual.map((y, k) => ({ ...y, profitAfterTax: 9_000_000 + k * 100_000 })) }).g! < 2);
check("a cement company is an operating one, graded B: standard; rates move its P/E", d1.type === "operating" && d1.policy === "standard" && d1.peSpread === 4 && d1.governance === "green");
check("as of its latest figures", d1.asOf === "2026-06-30");
const jump = draftFrom({ ...base, annual: [...base.annual, { fiscalYear: 2026, eps: null, profitAfterTax: 25_000_000 }] });
check("a year far from its 3-year median is averaged with it, and said", jump.eps === 17.5 && jump.note.includes("averaged"), { eps: jump.eps, note: jump.note });
const withFiling = draftFrom({ ...base, filing: { ...rf, date: "2026-08-28", title: "Financial results", url: "https://dps.psx.com.pk/download/document/1.pdf" } });
check("a newer annual result from a filing is the latest year", withFiling.asOf === "2026-06-30" && (withFiling.evidence.years as any[]).some((y) => y[0] === "2026-06-30" && y[1] === 13.25) && withFiling.note.includes("filing"), withFiling.evidence.years);
const kept = draftFrom({ ...base, previous: { governance: "amber", confirm: "1QFY27 results", policy: "quality", pe: 9, sotp: { parts: [], netDebt: 0, discount: 0, shares: 1 } } });
check("the owner's judgements carry over: governance, its event, policy, multiple, parts", kept.governance === "amber" && kept.confirm === "1QFY27 results" && kept.policy === "quality" && kept.pe === 9 && kept.peSpread === null && kept.sotp != null);
check("sectors to business types", typeOfSector("COMMERCIAL BANKS") === "bank" && typeOfSector("INSURANCE") === "insurer" && typeOfSector("INV BANKS INV COS SECURITIES COS") === "holdco" && typeOfSector("MODARABAS") === "shell" && typeOfSector("CEMENT") === "operating");
check("a draft is new only when it says something new", draftDiffers(d1, null) && !draftDiffers(d1, { ...d1 }) && draftDiffers(d1, { ...d1, eps: 9 }) && !draftDiffers(d1, { ...d1, eps: 10.1 }));
check("a review date later than the data is not news", !draftDiffers(d1, { ...d1, asOf: "2026-10-13" }));
const dF = { ...d1, evidence: { ...d1.evidence, filing: { date: "2026-10-20", url: "/download/document/9.pdf" } } };
check("a filing after the review is news", draftDiffers(dF, { ...d1, asOf: "2026-10-13" }) && !draftDiffers(dF, { ...d1, asOf: "2026-10-21" }));
check("the same suggestion signs the same", draftSignature(d1) === draftSignature({ ...d1, asOf: "2030-01-01", note: "x" }) && draftSignature(d1) !== draftSignature(dF) && draftSignature(d1) !== draftSignature({ ...d1, eps: (d1.eps ?? 0) + 1 }));
check("no balance sheet: no book value, and said", draftFrom({ ...base, equity: null }).bvps === null && draftFrom({ ...base, equity: null }).note.includes("balance sheet"));
const half = draftFrom({ ...base, filing: { period: "half year", periodEnd: "2025-12-31", eps: 6, epsPrior: 5, profit: null, dps: null, text: true, date: "2026-02-20", title: "Financial results", url: "u" } });
check("a part year makes a trailing year: last year + this year to date - the same months before", half.eps === 11 && half.note.includes("Trailing year"), { eps: half.eps, note: half.note });
const quarter = draftFrom({ ...base, filing: { period: "quarter", periodEnd: "2026-09-30", eps: 3, epsPrior: 2.5, profit: null, equity: 90_000_000_000, dps: null, text: true, date: "2026-10-25", title: "Financial results", url: "u" } });
check("no trailing year without the year before it; a newer book from the filing", quarter.eps === 10 && quarter.bvps === 90 && quarter.note.includes("Book from the filing") && quarter.asOf === "2026-09-30", { eps: quarter.eps, bvps: quarter.bvps, asOf: quarter.asOf });

// --- settling what the model read ----------------------------------------------------------------
const page = (o: Partial<PageRead>): PageRead => ({ page: 1, source: "image", title: "", unitText: "", statement: "other", periodEnd: "", periodMonths: 0, netProfit: null, netProfitPrior: null, eps: null, epsPrior: null, totalEquity: null, shareCapital: null, ...o });
const csap = [
  page({ page: 3, title: "UNCONSOLIDATED STATEMENT OF FINANCIAL POSITION AS AT JUNE 30, 2026", unitText: "(Rupees in '000)", statement: "financial position", periodEnd: "2026-06-30", periodMonths: 12, totalEquity: 9665992, shareCapital: 776325 }),
  page({ page: 5, title: "UNCONSOLIDATED STATEMENT OF PROFIT OR LOSS AND OTHER COMPREHENSIVE INCOME FOR THE YEAR ENDED JUNE 30, 2026", unitText: "(Rupees in '000)", statement: "profit or loss", periodEnd: "2026-06-30", periodMonths: 12, netProfit: 1291411, netProfitPrior: 1343279, eps: 16.63, epsPrior: 17.3 }),
  page({ page: 9, title: "CONSOLIDATED STATEMENT OF PROFIT OR LOSS FOR THE YEAR ENDED JUNE 30, 2026", unitText: "(Rupees in '000)", statement: "profit or loss", periodEnd: "2026-06-30", periodMonths: 12, netProfit: 1500000, eps: 19.32, epsPrior: 18 }),
];
const ctxC = { sharesNow: 77_632_491, lastEps: 17.3, lastBvps: 112.7 };
const sc = settleFigures(csap, ctxC);
check("the company's own statements, scaled by the unit and checked: EPS = profit / shares", sc.basis === "unconsolidated" && sc.period === "year" && sc.periodEnd === "2026-06-30" && sc.eps === 16.63 && sc.epsPrior === 17.3 && sc.profit === 1_291_411_000 && sc.equity === 9_665_992_000 && sc.checks.length === 0, sc);
const wrongUnit = settleFigures([{ ...csap[1], unitText: "Rupees" }], ctxC);
check("a unit line that says rupees for thousands: the EPS check finds the scale", wrongUnit.profit === 1_291_411_000);
const badEps = settleFigures([{ ...csap[1], eps: 0.2952 }], ctxC);
check("an EPS that neither the profit nor last year supports is left out, and said", badEps.eps === null && badEps.checks.some((c) => c.includes("0.2952")), badEps);
const noProfit = settleFigures([{ ...csap[1], netProfit: null }], ctxC);
check("an EPS near last year's is kept without a profit, and said", noProfit.eps === 16.63 && noProfit.checks.some((c) => c.includes("without a profit")));
check("an EPS with no profit and no year to compare is left out, and said", settleFigures([{ ...csap[1], netProfit: null }], { ...ctxC, lastEps: null }).checks.some((c) => c.includes("no profit to check")));
check("only group figures: used, and said", settleFigures([csap[2]], { ...ctxC, sharesNow: 77_632_491 }).checks.some((c) => c.includes("consolidated")));
check("titles to bases; unit lines to scales", basisOf("Un-consolidated Statement of Profit or Loss") === "unconsolidated" && basisOf("Consolidated Statement of Financial Position") === "consolidated" && basisOf("Statement of Profit or Loss") === null && scaleOf("(Rupees in '000)") === 1e3 && scaleOf("Rupees in million") === 1e6 && scaleOf("(Rupees)") === 1 && scaleOf("") === null);
check("nothing read: said", settleFigures([], ctxC).checks.includes("No profit or loss statement found."));
const hin = [
  page({ page: 2, title: "UNCONSOLIDATED CONDENSED INTERIM STATEMENT OF FINANCIAL POSITION AS AT JUNE 30, 2026", unitText: "Rupees", statement: "financial position", periodEnd: "2026-06-30", periodMonths: 6, totalAssets: 17_154_937_420, totalEquity: 17_154_937_420, shareCapital: 529_833_630 }),
  page({ page: 3, title: "UNCONSOLIDATED CONDENSED INTERIM STATEMENT OF PROFIT OR LOSS FOR THE SIX MONTHS PERIOD ENDED JUNE 30, 2026", unitText: "", statement: "profit or loss", periodEnd: "2026-06-30", periodMonths: 6, netProfit: 1_677_455_733, eps: 31.66, epsPrior: 30.71 }),
];
const sh = settleFigures(hin, { sharesNow: 52_983_368, lastEps: 77.75, lastBvps: 230.2 });
check("an equity equal to total assets is the wrong line: left out, and said; the profit still read", sh.equity === null && sh.checks.some((c) => c.includes("total-assets")) && sh.eps === 31.66 && sh.period === "half year" && !sh.checks.some((c) => c.includes("No unit")), sh);
const ahcl = [page({ title: "UNCONSOLIDATED STATEMENT OF FINANCIAL POSITION AS AT JUNE 30, 2026", unitText: "Rupees", statement: "financial position", periodEnd: "2026-06-30", totalEquity: 102_208_874_636, totalAssets: 140_000_000_000 })];
const ctxA = { sharesNow: 4_216_967_470, lastEps: 10.55, lastBvps: 16.08, lastEquity: 67_800_921_654, lastEquityAt: "2026-03-31" };
check("an equity 50% off the server's of a quarter before is left out, and said", settleFigures(ahcl, ctxA).equity === null && settleFigures(ahcl, ctxA).checks.some((c) => c.includes("far from")));
const rv = settleFigures([{ ...ahcl[0], totalEquity: 75_000_000_000, revaluationSurplus: 5_000_000_000 }], ctxA);
check("the revaluation surplus is read with the equity", rv.equity === 75_000_000_000 && rv.revaluation === 5_000_000_000);
const mureb = draftFrom({ ...base, equity: null, equityAt: null, filing: { period: "year", periodEnd: "2026-06-30", eps: null, profit: null, dps: null, text: true, equity: 20_766_918_000, revaluation: 5_145_555_000, date: "2026-09-18", title: "Financial results", url: "u" }, sharesNow: 27_663_631 });
check("the book a share leaves the revaluation surplus out, and says so", mureb.bvps === 564.69 && mureb.note.includes("revaluation surplus"), { bvps: mureb.bvps, note: mureb.note });
check("an equity near the server's is kept", settleFigures([{ ...ahcl[0], totalEquity: 75_000_000_000 }], ctxA).equity === 75_000_000_000);

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
