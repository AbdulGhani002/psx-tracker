import { valueFund } from "../lib/calculations/assets";

let pass = 0,
  fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) {
    pass++;
    console.log("PASS ", name, got ?? "");
  } else {
    fail++;
    console.log("FAIL ", name, got ?? "");
  }
}

// Daily-dividend fund: units constant, effective NAV ticks up daily at the yield.
const dd = valueFund({ units: 100, avgCost: 100, dailyDividend: true, annualYieldPct: 17, anchorDate: "2026-03-17" }, 100, "2026-06-15");
check("daily-dividend units stay constant", dd.units === 100, dd.units);
check("daily-dividend effective NAV > par", dd.effectiveNav > 100 && dd.effectiveNav < 105, dd.effectiveNav.toFixed(3));
check("daily-dividend daily yield shown", dd.dailyYieldPct > 0.04 && dd.dailyYieldPct < 0.05, dd.dailyYieldPct.toFixed(4) + "%/day");
check("daily-dividend cost = principal", dd.cost === 10000, dd.cost);
check("daily-dividend positive return (was 0)", dd.unrealizedPct > 0.03 && dd.unrealizedPct < 0.05, (dd.unrealizedPct * 100).toFixed(2) + "%");

// No yield / no anchor → effective NAV stays at par (no accrual yet).
const manual = valueFund({ units: 100, avgCost: 100, dailyDividend: true, annualYieldPct: 0, anchorDate: "" }, 100, "2026-06-15");
check("daily-dividend with 0 yield = NAV stays par", manual.effectiveNav === 100, manual.effectiveNav);

// Growth fund unchanged: value = units * NAV.
const g = valueFund({ units: 178.76, avgCost: 100 }, 112.25, "2026-06-15");
check("growth fund value = units*nav", Math.round(g.value) === 20066, Math.round(g.value));
check("growth fund return from NAV rise", Math.abs(g.unrealizedPct - 0.1225) < 0.001, (g.unrealizedPct * 100).toFixed(2) + "%");
check("growth fund not flagged daily", g.dailyDividend === false, g.dailyDividend);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
