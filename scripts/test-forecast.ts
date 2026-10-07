import { forecastDividends, buildDividendProfiles, type FundamentalsInput } from "../lib/calculations/dividend-forecast";
import type { Transaction, Holding } from "../lib/types";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}  ${d}`); };

function tx(p: Partial<Transaction>): Transaction {
  return {
    _id: Math.random().toString(36), symbol: "X", type: "DIVIDEND", date: "2025-01-01",
    shares: 0, pricePerShare: 0, totalAmount: 0, fees: 0, netAmount: 0, notes: "", ratio: "",
    createdAt: "", updatedAt: "", ...p,
  } as Transaction;
}
function hld(symbol: string, shares: number): Holding {
  return { symbol, name: symbol, currentShares: shares } as Holding;
}
function fund(latestEps: number, epsByYear: Record<number, number>): FundamentalsInput {
  return { faceValue: 10, latestEps, epsByYear, epsGrowthPct: null };
}

const asOf = new Date("2026-06-06T00:00:00Z"); // PK fiscal year ending 2026 is still running

// ANN  — healthy annual payer: Rs 5/yr once a year, EPS 10 (50% payout).
// QTR  — healthy quarterly payer: Rs 1 x4 = Rs 4/yr, EPS 8 (50% payout).
// OVER — pays Rs 15/yr but only earns EPS 5 (the AHCL problem): must be capped.
// LOSS — loss-making (EPS -2): should forecast no dividend.
const txs: Transaction[] = [
  tx({ symbol: "ANN", date: "2022-10-15", pricePerShare: 5 }),
  tx({ symbol: "ANN", date: "2023-10-15", pricePerShare: 5 }),
  tx({ symbol: "ANN", date: "2024-10-15", pricePerShare: 5 }),

  tx({ symbol: "QTR", date: "2023-08-01", pricePerShare: 1 }),
  tx({ symbol: "QTR", date: "2023-11-01", pricePerShare: 1 }),
  tx({ symbol: "QTR", date: "2024-02-01", pricePerShare: 1 }),
  tx({ symbol: "QTR", date: "2024-05-01", pricePerShare: 1 }),
  tx({ symbol: "QTR", date: "2024-08-01", pricePerShare: 1 }),
  tx({ symbol: "QTR", date: "2024-11-01", pricePerShare: 1 }),
  tx({ symbol: "QTR", date: "2025-02-01", pricePerShare: 1 }),
  tx({ symbol: "QTR", date: "2025-05-01", pricePerShare: 1 }),

  tx({ symbol: "OVER", date: "2022-10-15", pricePerShare: 15 }),
  tx({ symbol: "OVER", date: "2023-10-15", pricePerShare: 15 }),
  tx({ symbol: "OVER", date: "2024-10-15", pricePerShare: 15 }),

  tx({ symbol: "LOSS", date: "2024-10-15", pricePerShare: 3 }),
];
const holdings: Holding[] = [hld("ANN", 1000), hld("QTR", 500), hld("OVER", 100), hld("LOSS", 100)];
const fundamentals: Record<string, FundamentalsInput> = {
  ANN: fund(10, { 2023: 10, 2024: 10, 2025: 10 }),
  QTR: fund(8, { 2024: 8, 2025: 8 }),
  OVER: fund(5, { 2023: 5, 2024: 5, 2025: 5 }),
  LOSS: fund(-2, { 2025: -2 }),
};

console.log("=== profiles (earnings-grounded) ===");
const profiles = buildDividendProfiles(txs, holdings, { asOf, fundamentals });
const P = (s: string) => profiles.find((p) => p.symbol === s)!;

ok("ANN cadence annual", P("ANN").cadence === "annual", P("ANN").cadence);
ok("ANN payout ratio 50%", Math.abs((P("ANN").medianPayoutRatioPct ?? 0) - 50) < 1e-9, `${P("ANN").medianPayoutRatioPct}`);
ok("ANN forward DPS = 5", Math.abs(P("ANN").forwardDpsAnnual - 5) < 1e-9, `${P("ANN").forwardDpsAnnual}`);
ok("ANN income = 5000", Math.abs(P("ANN").expectedAnnualIncome - 5000) < 1e-6, `${P("ANN").expectedAnnualIncome}`);
ok("ANN comfortable (cover 2)", P("ANN").sustainability === "comfortable", P("ANN").sustainability);

ok("QTR cadence quarterly", P("QTR").cadence === "quarterly", P("QTR").cadence);
ok("QTR forward DPS = 4", Math.abs(P("QTR").forwardDpsAnnual - 4) < 1e-9, `${P("QTR").forwardDpsAnnual}`);

// The headline fix: OVER pays Rs 15 but earns Rs 5 — capped to EPS (100% payout), not 15.
ok("OVER applied payout capped at 100%", P("OVER").appliedPayoutRatioPct === 100, `${P("OVER").appliedPayoutRatioPct}`);
ok("OVER forward DPS capped to 5 (not 15)", Math.abs(P("OVER").forwardDpsAnnual - 5) < 1e-9, `${P("OVER").forwardDpsAnnual}`);
ok("OVER declared still shows 15", Math.abs(P("OVER").declaredAnnualDps - 15) < 1e-9, `${P("OVER").declaredAnnualDps}`);
ok("OVER income = 500 (not 1500)", Math.abs(P("OVER").expectedAnnualIncome - 500) < 1e-6, `${P("OVER").expectedAnnualIncome}`);
ok("OVER flagged above earnings", P("OVER").aboveEarnings === true && P("OVER").sustainability === "above earnings", P("OVER").sustainability);

ok("LOSS forecasts no dividend", P("LOSS").forwardDpsAnnual === 0, `${P("LOSS").forwardDpsAnnual}`);
ok("LOSS sustainability 'no dividend'", P("LOSS").sustainability === "no dividend", P("LOSS").sustainability);

console.log("=== forecast events ===");
const f = forecastDividends(txs, holdings, { asOf, fundamentals });
ok("ANN: 1 event", f.events.filter((e) => e.symbol === "ANN").length === 1, `${f.events.filter((e) => e.symbol === "ANN").length}`);
ok("QTR: 4 events", f.events.filter((e) => e.symbol === "QTR").length === 4, `${f.events.filter((e) => e.symbol === "QTR").length}`);
ok("OVER: 1 event", f.events.filter((e) => e.symbol === "OVER").length === 1);
ok("LOSS: no events", f.events.filter((e) => e.symbol === "LOSS").length === 0);
ok("total12m = 7500", Math.abs(f.total12m - 7500) < 1e-6, `${f.total12m}`);
ok("12 month buckets", f.months.length === 12, `${f.months.length}`);
ok("buckets sum to total", Math.abs(f.months.reduce((s, m) => s + m.total, 0) - f.total12m) < 1e-6);
ok("all events inside window", f.events.every((e) => e.date > asOf && e.date < f.windowEnd));

// Yield needs a price.
const fp = forecastDividends(txs, holdings, { asOf, fundamentals, prices: { ANN: 100 } });
ok("ANN yield = 5% at price 100", Math.abs((buildDividendProfiles(txs, holdings, { asOf, fundamentals, prices: { ANN: 100 } }).find((p) => p.symbol === "ANN")!.forwardYieldPct ?? 0) - 5) < 1e-9);

// --- PSX-payouts-driven (authoritative cadence, no recorded dividends) ---
console.log("=== PSX payouts source ===");
const psxFund: Record<string, FundamentalsInput> = {
  PSXQ: {
    faceValue: 10,
    latestEps: 20,
    epsByYear: { 2024: 20, 2025: 20 },
    epsGrowthPct: 0,
    payouts: [
      { date: "2025-09-15", pctOfFace: 100, cycle: "F", type: "cash" },
      { date: "2025-10-15", pctOfFace: 50, cycle: "i", type: "cash" },
      { date: "2026-02-15", pctOfFace: 50, cycle: "ii", type: "cash" },
      { date: "2026-04-15", pctOfFace: 50, cycle: "iii", type: "cash" },
      { date: "2025-08-01", pctOfFace: 20, cycle: "", type: "bonus" }, // 20% bonus → shares grow
    ],
  },
};
const pq = buildDividendProfiles([], [hld("PSXQ", 100)], { asOf, fundamentals: psxFund });
const Q = pq.find((p) => p.symbol === "PSXQ")!;
ok("PSXQ profile built from payouts (no recorded divs)", !!Q && Q.source === "psx", Q?.source);
ok("PSXQ cadence quarterly (i/ii/iii/F)", Q.cadence === "quarterly", Q.cadence);
ok("PSXQ declared = Rs 25 (250% of face)", Math.abs(Q.declaredAnnualDps - 25) < 1e-9, `${Q.declaredAnnualDps}`);
ok("PSXQ forward capped to EPS 20", Math.abs(Q.forwardDpsAnnual - 20) < 1e-9, `${Q.forwardDpsAnnual}`);
ok("PSXQ above earnings flagged", Q.aboveEarnings === true, `${Q.aboveEarnings}`);
ok("PSXQ bonus 20% detected", Q.recentBonusPct === 20, `${Q.recentBonusPct}`);
ok("PSXQ projected +20 bonus shares (100 x 20%)", Q.projectedBonusShares === 20, `${Q.projectedBonusShares}`);
const pqf = forecastDividends([], [hld("PSXQ", 100)], { asOf, fundamentals: psxFund });
ok("PSXQ 4 forecast events", pqf.events.filter((e) => e.symbol === "PSXQ").length === 4, `${pqf.events.filter((e) => e.symbol === "PSXQ").length}`);
ok("PSXQ 1 bonus event", pqf.bonusEvents.filter((e) => e.symbol === "PSXQ").length === 1, `${pqf.bonusEvents.length}`);
// All 4 dividends fall after the Aug-2026 bonus → on 120 shares: 20 x 120 = 2400.
ok("PSXQ total = 2400 (dividends grown by bonus)", Math.abs(pqf.total12m - 2400) < 1e-6, `${pqf.total12m}`);

// --- Split: a 1:2 split halves face value, so a 100% dividend = Rs 5/share ---
console.log("=== split-adjusted face ===");
const splTx: Transaction[] = [tx({ symbol: "SPL", type: "SPLIT", date: "2024-01-01", ratio: "1:2" })];
const splFund: Record<string, FundamentalsInput> = {
  SPL: { faceValue: 10, latestEps: 20, epsByYear: { 2024: 20, 2025: 20 }, epsGrowthPct: 0, payouts: [{ date: "2025-09-15", pctOfFace: 100, cycle: "F", type: "cash" }] },
};
const sp = buildDividendProfiles(splTx, [hld("SPL", 200)], { asOf, fundamentals: splFund }).find((p) => p.symbol === "SPL")!;
ok("SPL face value halved to 5 (1:2 split)", Math.abs(sp.faceValue - 5) < 1e-9, `${sp.faceValue}`);
ok("SPL hasSplit flagged", sp.hasSplit === true, `${sp.hasSplit}`);
ok("SPL declared = Rs 5 (100% of Rs 5 face, not Rs 10)", Math.abs(sp.declaredAnnualDps - 5) < 1e-9, `${sp.declaredAnnualDps}`);

// --- Face value calibrated from recorded dividends (NOT hardcoded to 10) ---
console.log("=== face value calibration ===");
const calFund: Record<string, FundamentalsInput> = {
  CAL10: { faceValue: 10, latestEps: 20, epsByYear: { 2025: 20 }, epsGrowthPct: 0, payouts: [{ date: "2025-09-15", pctOfFace: 50, cycle: "F", type: "cash" }] },
  CAL5: { faceValue: 10, latestEps: 20, epsByYear: { 2025: 20 }, epsGrowthPct: 0, payouts: [{ date: "2025-09-15", pctOfFace: 100, cycle: "F", type: "cash" }] },
};
const calTx: Transaction[] = [
  tx({ symbol: "CAL10", date: "2025-09-20", pricePerShare: 5 }), // Rs 5 received vs 50% declared -> par 10
  tx({ symbol: "CAL5", date: "2025-09-20", pricePerShare: 5 }), // Rs 5 received vs 100% declared -> par 5
];
const cal = buildDividendProfiles(calTx, [hld("CAL10", 100), hld("CAL5", 100)], { asOf, fundamentals: calFund });
const c10 = cal.find((p) => p.symbol === "CAL10")!;
const c5 = cal.find((p) => p.symbol === "CAL5")!;
ok("CAL10 par calibrated to 10 (Rs5 / 50%)", c10.faceValue === 10 && c10.faceValueSource === "calibrated", `${c10.faceValue}/${c10.faceValueSource}`);
ok("CAL5 par calibrated to 5 (Rs5 / 100%)", c5.faceValue === 5 && c5.faceValueSource === "calibrated", `${c5.faceValue}/${c5.faceValueSource}`);
ok("CAL5 declared = Rs 5 (100% of par 5, not 10)", Math.abs(c5.declaredAnnualDps - 5) < 1e-9, `${c5.declaredAnnualDps}`);

// Conflicting recorded amounts (the AHCL case) must NOT mis-calibrate par — fall back to 10.
const conflictFund: Record<string, FundamentalsInput> = {
  CONF: { faceValue: 10, latestEps: 6, epsByYear: { 2024: 6, 2025: 6 }, epsGrowthPct: 0, payouts: [
    { date: "2025-09-15", pctOfFace: 100, cycle: "F", type: "cash" },
    { date: "2024-11-05", pctOfFace: 100, cycle: "F", type: "cash" },
  ] },
};
const conflictTx: Transaction[] = [
  tx({ symbol: "CONF", date: "2025-09-18", pricePerShare: 10 }), // -> implies 10
  tx({ symbol: "CONF", date: "2024-11-08", pricePerShare: 1 }), // -> implies 1 (messy)
];
const conf = buildDividendProfiles(conflictTx, [hld("CONF", 100)], { asOf, fundamentals: conflictFund }).find((p) => p.symbol === "CONF")!;
ok("CONF par falls back to 10 on conflicting evidence", conf.faceValue === 10 && conf.faceValueSource === "assumed", `${conf.faceValue}/${conf.faceValueSource}`);

// --- Per-holding overrides + dividend growth ---
console.log("=== overrides + growth ===");
const ovHold = { symbol: "OVR", name: "OVR", currentShares: 100, dividendOverride: { parValue: 0, cadence: "quarterly", payoutRatioPct: 0, expectedAnnualDps: 7 } } as unknown as Holding;
const ovp = buildDividendProfiles([tx({ symbol: "OVR", date: "2025-09-15", pricePerShare: 3 })], [ovHold], { asOf, fundamentals: { OVR: fund(5, { 2025: 5 }) } }).find((p) => p.symbol === "OVR")!;
ok("override pins forward DPS to 7", Math.abs(ovp.forwardDpsAnnual - 7) < 1e-9, `${ovp.forwardDpsAnnual}`);
ok("override income = 700", Math.abs(ovp.expectedAnnualIncome - 700) < 1e-6, `${ovp.expectedAnnualIncome}`);
ok("override cadence = quarterly", ovp.cadence === "quarterly", ovp.cadence);
ok("overridden flag set", ovp.overridden === true);

const parHold = { symbol: "PAR", name: "PAR", currentShares: 100, dividendOverride: { parValue: 5, cadence: "", payoutRatioPct: 0, expectedAnnualDps: 0 } } as unknown as Holding;
const parFund: Record<string, FundamentalsInput> = { PAR: { faceValue: 10, latestEps: 20, epsByYear: { 2025: 20 }, epsGrowthPct: 0, payouts: [{ date: "2025-09-15", pctOfFace: 100, cycle: "F", type: "cash" }] } };
const parp = buildDividendProfiles([], [parHold], { asOf, fundamentals: parFund }).find((p) => p.symbol === "PAR")!;
ok("par override -> faceValue 5, source override", parp.faceValue === 5 && parp.faceValueSource === "override", `${parp.faceValue}/${parp.faceValueSource}`);
ok("par override -> declared 5 (100% of 5)", Math.abs(parp.declaredAnnualDps - 5) < 1e-9, `${parp.declaredAnnualDps}`);

const grFund: Record<string, FundamentalsInput> = { GRW: { faceValue: 10, latestEps: 10, epsByYear: { 2025: 10 }, epsGrowthPct: 45, payouts: [{ date: "2025-09-15", pctOfFace: 50, cycle: "F", type: "cash" }] } };
const grp = buildDividendProfiles([], [hld("GRW", 100)], { asOf, fundamentals: grFund }).find((p) => p.symbol === "GRW")!;
ok("dividend growth clamped to 30%", grp.dividendGrowthPct === 30, `${grp.dividendGrowthPct}`);

// --- Expected later this financial year (due): each of last year's payouts a
// year on, gone once its date passes or the real one is announced or paid.
// The patterns are the user's own, as on 7 Oct 2026.
const oct7 = new Date("2026-10-07T00:00:00Z");
const pf = (payouts: Array<[string, number, string]>): FundamentalsInput => ({ faceValue: 10, latestEps: 30, epsByYear: { 2025: 28, 2026: 30 }, epsGrowthPct: 5, payouts: payouts.map(([date, pctOfFace, cycle]) => ({ date, pctOfFace, cycle, type: "cash" as const })) });
const dueFund: Record<string, FundamentalsInput> = {
  // Announced its final on 18 Sep 2026: that payout is real, not expected again in Sep 2027.
  MUREB: pf([["2025-10-27", 50, "i"], ["2026-02-23", 120, "F"], ["2026-09-18", 145, "F"]]),
  // Last year's final (29 Sep) has passed and this year's was announced on 8 Sep; the interim is to come.
  PTL: pf([["2025-09-29", 20, "F"], ["2026-03-05", 20, "i"], ["2026-09-08", 20, "F"]]),
  // Paid in Sep 2025, nothing yet this year: the date has passed, so it is gone, not moved to 2027.
  AHCL: pf([["2025-09-23", 100, "F"]]),
  // Four a year; the August one was paid on 29 Aug (recorded).
  MEBL: pf([["2025-08-13", 50, "ii"], ["2025-10-27", 70, "iii"], ["2026-02-09", 70, "F"], ["2026-04-23", 75, "i"]]),
};
const dueTx = [tx({ symbol: "MEBL", date: "2026-08-29", pricePerShare: 5, netAmount: 306 })];
const dueF = forecastDividends(dueTx, ["MUREB", "PTL", "AHCL", "MEBL"].map((s) => hld(s, 100)), { asOf: oct7, fundamentals: dueFund });
const dueOf = (s: string) => dueF.due.filter((e) => e.symbol === s).map((e) => e.date.toISOString().slice(0, 10));
ok("nothing expected is in the past", dueF.due.every((e) => e.date > oct7));
ok("nothing is pushed into the next financial year", dueF.due.every((e) => e.date < new Date("2027-07-01T00:00:00Z")), dueF.due.map((e) => e.symbol + " " + e.date.toISOString().slice(0, 10)).join(", "));
ok("MUREB: last year's interim and final a year on, not the final just announced", dueOf("MUREB").join() === "2026-10-27,2027-02-23", dueOf("MUREB").join());
ok("PTL: the passed final is gone, the interim is to come", dueOf("PTL").join() === "2027-03-05", dueOf("PTL").join());
ok("AHCL: a date that passed without a payout is dropped, not moved a year", dueOf("AHCL").length === 0, dueOf("AHCL").join());
ok("MEBL: three still to come, the August one passed and paid", dueOf("MEBL").join() === "2026-10-27,2027-02-09,2027-04-23", dueOf("MEBL").join());
const early = forecastDividends(dueTx, [hld("PTL", 100)], { asOf: new Date("2027-02-25T00:00:00Z"), fundamentals: { PTL: pf([["2025-09-29", 20, "F"], ["2026-03-05", 20, "i"], ["2026-09-08", 20, "F"], ["2027-02-20", 20, "i"]]) } });
ok("an interim announced early takes the expected one off at once", early.due.filter((e) => e.symbol === "PTL").length === 0, early.due.map((e) => e.date.toISOString().slice(0, 10)).join());
const paidEarly = forecastDividends([tx({ symbol: "PTL", date: "2027-02-28", pricePerShare: 2 })], [hld("PTL", 100)], { asOf: new Date("2027-03-01T00:00:00Z"), fundamentals: { PTL: pf([["2025-09-29", 20, "F"], ["2026-03-05", 20, "i"], ["2026-09-08", 20, "F"]]) } });
ok("so does a payout already recorded, before its expected date", paidEarly.due.filter((e) => e.symbol === "PTL").length === 0);
ok("the 12-month forecast itself is unchanged", dueF.events.length > 0 && Math.abs(dueF.total12m - dueF.events.reduce((s, e) => s + e.expectedGross, 0)) < 1e-6);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
