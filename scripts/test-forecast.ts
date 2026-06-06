import { forecastDividends, buildDividendProfiles } from "../lib/calculations/dividend-forecast";
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

const asOf = new Date("2026-06-06T00:00:00Z");

// ANN: annual payer with 3 years of history (high confidence), holds 1000 shares.
// QTR: quarterly payer, last 4 quarters, holds 500 shares.
// ZERO: has dividend history but 0 shares held -> must be excluded.
const txs: Transaction[] = [
  tx({ symbol: "ANN", date: "2023-09-15", pricePerShare: 5, totalAmount: 5000, netAmount: 4500 }),
  tx({ symbol: "ANN", date: "2024-09-15", pricePerShare: 5, totalAmount: 5000, netAmount: 4500 }),
  tx({ symbol: "ANN", date: "2025-09-15", pricePerShare: 5, totalAmount: 5000, netAmount: 4500 }),

  tx({ symbol: "QTR", date: "2025-08-01", pricePerShare: 2, totalAmount: 1000, netAmount: 900 }),
  tx({ symbol: "QTR", date: "2025-11-01", pricePerShare: 2, totalAmount: 1000, netAmount: 900 }),
  tx({ symbol: "QTR", date: "2026-02-01", pricePerShare: 2, totalAmount: 1000, netAmount: 900 }),
  tx({ symbol: "QTR", date: "2026-05-01", pricePerShare: 2, totalAmount: 1000, netAmount: 900 }),

  tx({ symbol: "ZERO", date: "2025-10-01", pricePerShare: 3, totalAmount: 3000, netAmount: 2700 }),
];
const holdings: Holding[] = [hld("ANN", 1000), hld("QTR", 500), hld("ZERO", 0)];

console.log("=== profiles ===");
const profiles = buildDividendProfiles(txs, holdings, asOf);
ok("two income holdings (ZERO excluded)", profiles.length === 2, `n=${profiles.length}`);
const ann = profiles.find((p) => p.symbol === "ANN")!;
const qtr = profiles.find((p) => p.symbol === "QTR")!;
ok("ANN cadence = 1/yr", ann.paymentsPerYear === 1, `ppy=${ann.paymentsPerYear}`);
ok("QTR cadence = 4/yr", qtr.paymentsPerYear === 4, `ppy=${qtr.paymentsPerYear}`);
ok("ANN annual rate/share = 5", Math.abs(ann.inferredAnnualRatePerShare - 5) < 1e-9, `r=${ann.inferredAnnualRatePerShare}`);
ok("QTR annual rate/share = 8", Math.abs(qtr.inferredAnnualRatePerShare - 8) < 1e-9, `r=${qtr.inferredAnnualRatePerShare}`);
ok("ANN confidence high (3y history)", ann.confidence === "high", ann.confidence);

console.log("=== forecast ===");
const f = forecastDividends(txs, holdings, asOf);
ok("5 forecast events (1 ANN + 4 QTR)", f.events.length === 5, `n=${f.events.length}`);
ok("total 12m = 9000", Math.abs(f.total12m - 9000) < 1e-6, `total=${f.total12m}`);
ok("no event for ZERO", !f.events.some((e) => e.symbol === "ZERO"));
ok("all events within next 12 months", f.events.every((e) => e.date > asOf && e.date <= f.windowEnd));

// ANN: 2025-09-15 -> 2026-09-15
const annEvent = f.events.find((e) => e.symbol === "ANN")!;
ok("ANN projected to 2026-09", annEvent.year === 2026 && annEvent.month === 8, `${annEvent.year}-${annEvent.month}`);
ok("ANN gross = 5000", Math.abs(annEvent.expectedGross - 5000) < 1e-6, `g=${annEvent.expectedGross}`);

// QTR gross each = 2 * 500 = 1000, four of them
const qtrEvents = f.events.filter((e) => e.symbol === "QTR");
ok("4 QTR events", qtrEvents.length === 4);
ok("QTR gross each = 1000", qtrEvents.every((e) => Math.abs(e.expectedGross - 1000) < 1e-6));

// months array always has 12 buckets
ok("12 month buckets", f.months.length === 12, `n=${f.months.length}`);
const bucketSum = f.months.reduce((s, m) => s + m.total, 0);
ok("month buckets sum to total12m", Math.abs(bucketSum - f.total12m) < 1e-6, `sum=${bucketSum}`);

// paidLast12m: dividends with date >= 2025-06-06, net summed.
// ANN 2025-09-15 (4500) + QTR x4 (900 each = 3600) = 8100. ZERO 2025-10-01 (2700) also counts (cash received regardless of current holding).
ok("paidLast12m = 10800", Math.abs(f.paidLast12m - 10800) < 1e-6, `paid=${f.paidLast12m}`);

console.log("=== leap-year + month-end clamp ===");
{
  const t2: Transaction[] = [
    tx({ symbol: "LEAP", date: "2024-02-29", pricePerShare: 1, totalAmount: 100, netAmount: 90 }),
    tx({ symbol: "EOM", date: "2025-01-31", pricePerShare: 1, totalAmount: 100, netAmount: 90 }),
  ];
  const h2: Holding[] = [hld("LEAP", 100), hld("EOM", 100)];
  const f2 = forecastDividends(t2, h2, asOf);
  const leap = f2.events.find((e) => e.symbol === "LEAP");
  ok("LEAP event exists", !!leap);
  ok("LEAP stays in February (month=1, not March)", !!leap && leap.month === 1, leap ? `month=${leap.month}` : "none");
  const eom = f2.events.find((e) => e.symbol === "EOM");
  ok("EOM stays in January (month=0)", !!eom && eom.month === 0, eom ? `month=${eom.month}` : "none");
  const bsum = f2.months.reduce((s, m) => s + m.total, 0);
  ok("f2 buckets sum to total12m", Math.abs(bsum - f2.total12m) < 1e-6, `bsum=${bsum} total=${f2.total12m}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
