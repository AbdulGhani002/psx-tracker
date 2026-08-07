// iSave statement parser tests.
// Run: npx tsx scripts/test-isave-parse.ts
//
// The GOOD fixture is the verbatim positional-extraction output of the real
// 06-Aug-2026 statement (iSave_SOA_1786034536776.pdf) — including its own dust
// rounding: MCBPSM prints 1.70 where .0044 × 384.5783 = 1.69, and the total
// 55,643.37 is computed on unrounded values (printed rows sum to 55,643.38).
// The parser must accept exactly this file and refuse tampered variants.

import { parseIsaveStatement, ISAVE_CODE_TO_MUFAP } from "../lib/funds/isave-parse";

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, extra = "") {
  cond ? (pass++, console.log(`  ok   ${label}`)) : (fail++, console.log(`  FAIL ${label}  ${extra}`));
}

const PAGE1 = [
  "Statement Period",
  "AUG-01-2026 To AUG-06-2026",
  "Registration # : 184422 Your Account Information",
  "MUHAMMAD ABDUL GHANI QURESHI Account No.: 862202411768583001",
  "GROWTH",
  "MCB CASH MANAGEMENT OPTIMIZER",
  "31-JUL-26",
  "Last Balance 536.4755",
  "No Activity",
  "Value of MCBCMO 536.4755 Units based on Repurchase price of Rs. 103.682 as on 06 AUG 2026 is Rs. 55,622.85",
  "MCB PAKISTAN STOCK MARKET FUND",
  "Value of MCBPSM .0044 Units based on Repurchase price of Rs. 384.5783 as on 06 AUG 2026 is Rs. 1.70",
  "Page 1 of 2",
];
const PAGE2 = [
  "MCB PAKISTAN SOVEREIGN FUND",
  "Value of MCBPSF .0903 Units based on Repurchase price of Rs. 55.86 as on 06 AUG 2026 is Rs. 5.05",
  "UNIT-B",
  "ALHAMRA DAILY DIVIDEND FUND",
  "Value of ALHDDF .1378 Units based on Repurchase price of Rs. 100 as on 06 AUG 2026 is Rs. 13.78",
  "Total Investment Value of Processed Transactions Based on Repurchase Price. 55,643.37",
  "Page 2 of 2",
];

console.log("real 06-Aug statement parses clean");
const st = parseIsaveStatement([PAGE1, PAGE2]);
ok("no problems", st.problems.length === 0, JSON.stringify(st.problems));
ok("registration read", st.registration === "184422");
ok("four funds", st.funds.length === 4);
const cmo = st.funds.find((f) => f.code === "MCBCMO")!;
ok("MCBCMO units exact", cmo.units === 536.4755);
ok("MCBCMO nav exact", cmo.nav === 103.682);
ok("MCBCMO value exact", cmo.value === 55_622.85);
ok("as-on ISO", cmo.asOf === "2026-08-06");
const psm = st.funds.find((f) => f.code === "MCBPSM")!;
ok("dust units without leading zero", psm.units === 0.0044);
ok("dust value tolerated (their 1.70 vs computed 1.69)", st.problems.every((p) => !p.startsWith("MCBPSM")));
ok("integer NAV parsed (ALHDDF Rs. 100)", st.funds.find((f) => f.code === "ALHDDF")!.nav === 100);
ok("total captured", st.totalStated === 55_643.37);
ok("computed sum close to stated", Math.abs(st.totalComputed - 55_643.38) < 0.005);
ok("every code has a MUFAP mapping", st.funds.every((f) => ISAVE_CODE_TO_MUFAP[f.code] != null));

console.log("\ntampered statements are refused");
const badUnits = [PAGE1.map((l) => l.replace("536.4755 Units", "636.4755 Units")), PAGE2];
const b1 = parseIsaveStatement(badUnits);
ok("tampered units → row gate fires", b1.problems.some((p) => p.startsWith("MCBCMO")), JSON.stringify(b1.problems));

const badTotal = [PAGE1, PAGE2.map((l) => l.replace("55,643.37", "58,643.37"))];
const b2 = parseIsaveStatement(badTotal);
ok("tampered total → sum gate fires", b2.problems.some((p) => p.includes("statement total")), JSON.stringify(b2.problems));

const noTotal = [PAGE1, PAGE2.filter((l) => !l.startsWith("Total Investment"))];
ok("missing total line → named problem", parseIsaveStatement(noTotal).problems.some((p) => p.includes("total line not found")));

ok("empty pages → loud, not silent", parseIsaveStatement([["hello", "world"]]).problems.some((p) => p.includes("no fund value lines")));

const dup = [PAGE1, [...PAGE2, "Value of MCBCMO 1.0000 Units based on Repurchase price of Rs. 1 as on 06 AUG 2026 is Rs. 1.00"]];
ok("duplicate code flagged", parseIsaveStatement(dup).problems.some((p) => p.includes("twice")));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
