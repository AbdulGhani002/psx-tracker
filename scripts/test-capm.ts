// Per-company required return (CAPM with adjusted beta).
// Betas below are REAL values measured from PSX prices by the analytics service.
// Run: npx tsx scripts/test-capm.ts

import { requiredReturn, blumeAdjustedBeta, explainRequiredReturn, BETA_MIN, BETA_MAX } from "../lib/calculations/capm";

let pass = 0, fail = 0;
function near(label: string, got: number, want: number, tol = 0.005) {
  Math.abs(got - want) <= tol
    ? (pass++, console.log(`  ok   ${label} = ${got.toFixed(3)}`))
    : (fail++, console.log(`  FAIL ${label}: got ${got}, want ${want}`));
}
function is(label: string, got: unknown, want: unknown) {
  got === want
    ? (pass++, console.log(`  ok   ${label} = ${JSON.stringify(got)}`))
    : (fail++, console.log(`  FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
}

const RF = 11.5; // live SBP policy rate
const ERP = 5.5; // Pakistan equity risk premium

console.log("Blume adjustment: shrink measured beta toward the market");
near("beta 1.0 stays 1.0", blumeAdjustedBeta(1.0), 1.0);
near("beta 0.20 (thin REIT) -> 0.4665", blumeAdjustedBeta(0.2045), 0.4670, 0.001);
near("beta 0.73 -> 0.819", blumeAdjustedBeta(0.7297), 0.8189, 0.001);
near("beta 1.60 -> 1.402", blumeAdjustedBeta(1.6), 1.402);

console.log("\nreal PSX betas → per-company hurdle (rf 11.5, ERP 5.5)");
// AHL, measured beta 0.7297 → adj 0.8189 → 11.5 + 0.8189*5.5 = 16.00%
const ahl = requiredReturn({ riskFreePct: RF, erpPct: ERP, betaRaw: 0.7297 });
near("AHL required return", ahl.requiredReturnPct, 16.004, 0.01);
is("AHL beta measured", ahl.betaSource, "measured");
// GRR REIT, measured 0.2045 → adj 0.4670 → 11.5 + 0.4670*5.5 = 14.07%
const grr = requiredReturn({ riskFreePct: RF, erpPct: ERP, betaRaw: 0.2045 });
near("GRR (thin REIT) required return", grr.requiredReturnPct, 14.068, 0.01);
// The whole point: a low-beta name still clears a sane equity hurdle...
is("thin REIT hurdle still above the money-market rate", grr.requiredReturnPct > RF, true);
// ...but a riskier name must clear MORE than a defensive one.
is("riskier share demands a higher return", ahl.requiredReturnPct > grr.requiredReturnPct, true);

console.log("\nunmeasured beta falls back to plain market risk (the old flat behaviour)");
const none = requiredReturn({ riskFreePct: RF, erpPct: ERP, betaRaw: null });
near("no beta -> rf + ERP", none.requiredReturnPct, 17.0);
is("beta assumed = 1", none.betaUsed, 1);
is("flagged as assumed", none.betaSource, "assumed-market");
is("raw beta not invented", none.betaRaw, null);
const nan = requiredReturn({ riskFreePct: RF, erpPct: ERP, betaRaw: NaN });
is("NaN beta -> assumed", nan.betaSource, "assumed-market");

console.log("\nthe r=17% the user reasons with is the beta=1 case");
near("rf 11.5 + 5.5 = 17", none.requiredReturnPct, 17.0);

console.log("\nclamps keep a freak beta from pricing a share absurdly");
const wild = requiredReturn({ riskFreePct: RF, erpPct: ERP, betaRaw: 9 });
is("huge beta clamped", wild.betaUsed, BETA_MAX);
const neg = requiredReturn({ riskFreePct: RF, erpPct: ERP, betaRaw: -3 });
is("negative beta clamped to floor", neg.betaUsed, BETA_MIN);
is("floor keeps equity above cash", neg.requiredReturnPct > RF, true);

console.log("\nexplanation names its sources");
const txt = explainRequiredReturn(ahl);
is("mentions SBP", txt.includes("SBP 11.5%"), true);
is("mentions measured beta", txt.includes("measured 0.73"), true);
is("assumed case says so", explainRequiredReturn(none).includes("no beta yet"), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
