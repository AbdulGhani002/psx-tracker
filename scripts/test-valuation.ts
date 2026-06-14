import { computeValuation } from "../lib/calculations/valuation";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}  ${d}`); };

const v = computeValuation({ price: 100, eps: 10, forwardDps: 5, dividendGrowthPct: 5, bookValuePerShare: 50, requiredReturnPct: 17, fairPE: 8 });
ok("P/E = 10", v.pe === 10, `${v.pe}`);
ok("earnings yield = 10%", v.earningsYieldPct === 10, `${v.earningsYieldPct}`);
ok("dividend yield = 5%", v.dividendYieldPct === 5, `${v.dividendYieldPct}`);
ok("P/B = 2", v.pb === 2, `${v.pb}`);
ok("ROE = 20%", v.roePct === 20, `${v.roePct}`);
ok("DDM fair ≈ 43.75", v.fairValueDDM != null && Math.abs(v.fairValueDDM - 43.75) < 0.01, `${v.fairValueDDM?.toFixed(2)}`);
ok("earnings fair = 80", v.fairValueEarnings === 80, `${v.fairValueEarnings}`);
ok("blended fair ≈ 61.88", v.fairValue != null && Math.abs(v.fairValue - 61.875) < 0.01, `${v.fairValue?.toFixed(2)}`);
ok("expensive (price 100 >> fair 62)", v.verdict === "expensive", v.verdict);

// g >= r -> DDM skipped, falls back to earnings fair value
const hg = computeValuation({ price: 50, eps: 10, forwardDps: 5, dividendGrowthPct: 20, bookValuePerShare: 0, requiredReturnPct: 17, fairPE: 8 });
ok("DDM null when growth ≥ required", hg.fairValueDDM === null, `${hg.fairValueDDM}`);
ok("fair falls back to earnings (80)", hg.fairValue === 80, `${hg.fairValue}`);
ok("no book value -> P/B & ROE null", hg.pb === null && hg.roePct === null);
ok("cheap (price 50 < fair 80)", hg.verdict === "cheap", hg.verdict);

// no EPS -> P/E and earnings fair null; DDM still works
const ne = computeValuation({ price: 30, eps: null, forwardDps: 3, dividendGrowthPct: 4, bookValuePerShare: 0, requiredReturnPct: 16, fairPE: 8 });
ok("no EPS -> P/E null", ne.pe === null);
ok("no EPS -> earnings fair null", ne.fairValueEarnings === null);
ok("no EPS -> DDM still computes", ne.fairValueDDM != null && ne.fairValue != null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
