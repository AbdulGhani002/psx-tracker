import { computeWithdrawal, realReturn, portfolioForIncome, simulateDepletion } from "../lib/calculations/withdrawal";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}  ${d}`); };

ok("real return 13% nom / 10% inf ≈ 2.73%", Math.abs(realReturn(13, 10) - 2.727) < 0.01, `${realReturn(13, 10).toFixed(3)}`);

const w = computeWithdrawal({ portfolio: 80_000_000, nominalReturnPct: 13, inflationPct: 10, safeRealRatePct: 3 });
ok("safe monthly on 8 crore = 200k", Math.abs(w.safeMonthly - 200_000) < 1, `${w.safeMonthly}`);
ok("max monthly on 8 crore ≈ 866,667", Math.abs(w.maxMonthly - 866_666.67) < 1, `${w.maxMonthly.toFixed(0)}`);
ok("per-lakh safe = 250", Math.abs(w.perLakhSafe - 250) < 1e-6, `${w.perLakhSafe}`);
ok("per-lakh max ≈ 1083", Math.abs(w.perLakhMax - 1083.33) < 0.5, `${w.perLakhMax.toFixed(2)}`);

ok("portfolio for 200k/mo @3% = 8 crore", Math.abs(portfolioForIncome(200_000, 3) - 80_000_000) < 1, `${portfolioForIncome(200_000, 3)}`);

// 20% income growth on a 13% portfolio MUST eventually run dry.
const aggressive = simulateDepletion({ portfolio: 80_000_000, nominalReturnPct: 13, incomeMonthly: 200_000, incomeGrowthPct: 20, years: 60 });
ok("20% growth runs dry", aggressive.runDryYear != null, `runDry=${aggressive.runDryYear}`);
ok("peak before run-dry", aggressive.peakYear > 0 && aggressive.runDryYear != null && aggressive.peakYear < aggressive.runDryYear, `peak=${aggressive.peakYear} dry=${aggressive.runDryYear}`);

// Income growing at/below the return survives indefinitely.
const sustainable = simulateDepletion({ portfolio: 80_000_000, nominalReturnPct: 13, incomeMonthly: 200_000, incomeGrowthPct: 10, years: 60 });
ok("10% growth survives 60y", sustainable.runDryYear == null && sustainable.endValue > 0, `end=${(sustainable.endValue / 1e6).toFixed(0)}M dry=${sustainable.runDryYear}`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
