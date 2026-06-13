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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
