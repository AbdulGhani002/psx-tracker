import { analyzeConcentration, analyzeCorrelation, stressTest } from "../lib/calculations/risk-analysis";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}  ${d}`); };

const con = analyzeConcentration(
  [
    { symbol: "A", sector: "Banks", marketValue: 60000 },
    { symbol: "B", sector: "Banks", marketValue: 30000 },
    { symbol: "C", sector: "Power", marketValue: 10000 },
  ],
  25
);
ok("total = 100k", con.totalValue === 100000);
ok("A = 60%, over cap", Math.abs(con.positions[0].pct - 60) < 1e-9 && con.positions[0].overCap, `${con.positions[0].pct}`);
ok("top1 = 60%", Math.abs(con.top1Pct - 60) < 1e-9);
ok("HHI = 0.46", Math.abs(con.hhi - 0.46) < 1e-9, `${con.hhi}`);
ok("effective holdings ≈ 2.17", Math.abs(con.effectiveHoldings - 2.1739) < 0.01, `${con.effectiveHoldings.toFixed(2)}`);
ok("highly concentrated", con.verdict === "highly concentrated", con.verdict);
ok("Banks sector = 90%", Math.abs((con.sectors.find((s) => s.sector === "Banks")?.pct ?? 0) - 90) < 1e-9);

const up = [{ date: "2026-01-01", close: 100 }, { date: "2026-01-02", close: 110 }, { date: "2026-01-03", close: 121 }, { date: "2026-01-04", close: 133 }];
const dn = [{ date: "2026-01-01", close: 100 }, { date: "2026-01-02", close: 90 }, { date: "2026-01-03", close: 81 }, { date: "2026-01-04", close: 73 }];
const cor = analyzeCorrelation([{ symbol: "UP", points: up }, { symbol: "UP2", points: up }, { symbol: "DN", points: dn }]);
ok("UP vs UP2 correlation = 1", Math.abs((cor.matrix[0][1] ?? 0) - 1) < 1e-6, `${cor.matrix[0][1]}`);
ok("UP vs DN correlation ≈ -1", (cor.matrix[0][2] ?? 0) < -0.98, `${cor.matrix[0][2]?.toFixed(3)}`);

const st = stressTest({ equity: 50000, funds: 20000, savings: 20000, cash: 10000, marketDropPct: 20, safeRatePct: 3 });
ok("base net worth 100k", st.baseNetWorth === 100000);
ok("stressed 86k (equity+funds −20%)", st.stressedNetWorth === 86000, `${st.stressedNetWorth}`);
ok("loss 14%", Math.abs(st.lossPct - 14) < 1e-9, `${st.lossPct}`);
ok("safe income 250 -> 215", Math.abs(st.safeIncomeBefore - 250) < 1e-6 && Math.abs(st.safeIncomeAfter - 215) < 1e-6, `${st.safeIncomeBefore}/${st.safeIncomeAfter}`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
