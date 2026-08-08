// iSave statement parser tests.
// Run: npx tsx scripts/test-isave-parse.ts
//
// The GOOD fixture is the verbatim positional-extraction output of the real
// 06-Aug-2026 statement (iSave_SOA_1786034536776.pdf) — including its own dust
// rounding: MCBPSM prints 1.70 where .0044 × 384.5783 = 1.69, and the total
// 55,643.37 is computed on unrounded values (printed rows sum to 55,643.38).
// The parser must accept exactly this file and refuse tampered variants.

import { parseIsaveStatement, walkCost, ISAVE_CODE_TO_MUFAP } from "../lib/funds/isave-parse";

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

console.log("\nactivity rows: the 27-Jul reconciliation, reproduced by machine");
// Reconstruction of the (hand-verified, since deleted) 27-Jul window: MCBCMO
// opened at 196.4325u, took the ALHDDF conversion consideration 20,156.26 and
// a Rs 15,000 purchase, closed at 536.4755u. The hand-done avg cost was
// 102.8123 — the walk must land on the same number.
const ACT_PAGE = [
  "Statement Period",
  "JUL-05-2026 To JUL-27-2026",
  "Registration # : 184422",
  "GROWTH",
  "MCB CASH MANAGEMENT OPTIMIZER",
  "05-JUL-26",
  "Last Balance 196.4325",
  "07-JUL-26 Conversion In 196.4547 102.6000 20,156.26 0.00 20,156.26 392.8872",
  "27-JUL-26 Purchase 143.5883 104.4653 15,000.00 0.00 15,000.00 536.4755",
  "Value of MCBCMO 536.4755 Units based on Repurchase price of Rs. 102.85 as on 27 JUL 2026 is Rs. 55,176.51",
  "Total Investment Value of Processed Transactions Based on Repurchase Price. 55,176.51",
];
const ast = parseIsaveStatement([ACT_PAGE]);
const acmo = ast.funds.find((f) => f.code === "MCBCMO")!;
ok("statement parses clean", ast.problems.length === 0, JSON.stringify(ast.problems));
ok("two activity rows", acmo.activity?.rows.length === 2);
ok("chain reconciles to the Value line", acmo.activity?.chainOk === true);
ok("both rows classified as money-in", acmo.activity?.rows.every((r) => r.costEffect === "money_in") === true);
ok("dates ISO", acmo.activity?.rows[0].date === "2026-07-07");
const walk = walkCost(acmo.activity!, 101.8163);
ok("walk ok", walk.ok, walk.reason);
ok("money in 35,156.26", Math.abs(walk.moneyIn - 35_156.26) < 0.01);
ok("REPRODUCES the hand-done avg cost 102.8123", Math.abs(walk.newAvgCost - 102.8123) < 0.001, String(walk.newAvgCost));

console.log("\nactivity rows: redemption takes cost out at the running average");
const RED_PAGE = [
  "Registration # : 184422",
  "MCB CASH MANAGEMENT OPTIMIZER",
  "Last Balance 100.0000",
  "10-JUL-26 Redemption 40.0000 102.0000 4,080.00 0.00 (4,080.00) 60.0000",
  "Value of MCBCMO 60.0000 Units based on Repurchase price of Rs. 102 as on 15 JUL 2026 is Rs. 6,120.00",
  "Total Investment Value of Processed Transactions Based on Repurchase Price. 6,120.00",
];
const rst = parseIsaveStatement([RED_PAGE]);
const rcmo = rst.funds.find((f) => f.code === "MCBCMO")!;
ok("redemption parses clean", rst.problems.length === 0, JSON.stringify(rst.problems));
ok("delta is negative (proven by balance, not words)", rcmo.activity?.rows[0].unitsDelta === -40);
const rwalk = walkCost(rcmo.activity!, 100);
ok("cost out 4,000 at avg 100 (not the 102 sale price)", rwalk.ok && Math.abs(rwalk.costOut - 4000) < 0.01, String(rwalk.costOut));
ok("avg cost unchanged by a redemption", Math.abs(rwalk.newAvgCost - 100) < 0.0001);

console.log("\nactivity rows: reinvested dividend adds units at zero cost");
const DIV_PAGE = [
  "Registration # : 184422",
  "ALHAMRA DAILY DIVIDEND FUND",
  "Last Balance 100.0000",
  "15-JUL-26 Dividend Re-Invest 0.5000 100.0000 50.00 0.00 50.00 100.5000",
  "Value of ALHDDF 100.5000 Units based on Repurchase price of Rs. 100 as on 20 JUL 2026 is Rs. 10,050.00",
  "Total Investment Value of Processed Transactions Based on Repurchase Price. 10,050.00",
];
const dst = parseIsaveStatement([DIV_PAGE]);
const dfund = dst.funds.find((f) => f.code === "ALHDDF")!;
ok("dividend row is units_only", dfund.activity?.rows[0].costEffect === "units_only");
const dwalk = walkCost(dfund.activity!, 100);
ok("avg cost DROPS when units arrive free", dwalk.ok && dwalk.newAvgCost < 100 && Math.abs(dwalk.newAvgCost - 10000 / 100.5) < 0.001, String(dwalk.newAvgCost));

console.log("\nactivity gates: broken chains and unknown natures refuse");
const BROKEN = [ACT_PAGE.map((l) => l.replace("392.8872", "395.0000"))][0];
const bst = parseIsaveStatement([BROKEN]);
ok("broken chain → chainOk false + problem", bst.funds[0].activity?.chainOk === false && bst.problems.length > 0, JSON.stringify(bst.problems));
ok("broken chain → walk refuses", !walkCost(bst.funds[0].activity!, 100).ok);

const WEIRD = [ACT_PAGE.map((l) => l.replace("Conversion In", "Mystery Credit"))][0];
const wst = parseIsaveStatement([WEIRD]);
ok("unknown nature → classified false", wst.funds[0].activity?.classified === false);
ok("unknown nature → walk refuses, names the reason", walkCost(wst.funds[0].activity!, 100).reason.includes("unrecognised"));

ok("no-activity statement (real 6-Aug) has null activity", st.funds.every((f) => f.activity === null));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
