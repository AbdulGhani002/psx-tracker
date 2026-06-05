import { valueSavings } from "../lib/calculations/assets";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}  ${d}`); };

// 100,000 at 11%/yr for exactly 365 days → ~111,000
{
  const v = valueSavings(
    { ratePercent: 11, anchorDate: "2025-06-05", anchorBalance: 100000, movements: [] },
    "2026-06-05"
  );
  ok("365d @11% ≈ 111,000", Math.abs(v.balance - 111000) < 50, `balance=${v.balance.toFixed(2)} profit=${v.profit.toFixed(2)}`);
}

// 0 days → exactly anchor
{
  const v = valueSavings(
    { ratePercent: 20, anchorDate: "2026-06-05", anchorBalance: 50000, movements: [] },
    "2026-06-05"
  );
  ok("0 days = anchor", Math.abs(v.balance - 50000) < 1e-6, `balance=${v.balance}`);
}

// Deposit mid-way: 100k anchor, +50k after ~half year, value > 150k
{
  const v = valueSavings(
    {
      ratePercent: 12,
      anchorDate: "2026-01-01",
      anchorBalance: 100000,
      movements: [{ date: "2026-04-01", type: "DEPOSIT", amount: 50000 }],
    },
    "2026-07-01"
  );
  ok("deposit adds + accrues", v.balance > 150000 && v.netDeposits === 50000, `balance=${v.balance.toFixed(2)} net=${v.netDeposits}`);
  ok("principal = anchor + net", Math.abs(v.principal - 150000) < 1e-6, `principal=${v.principal}`);
}

// Withdrawal reduces
{
  const v = valueSavings(
    {
      ratePercent: 10,
      anchorDate: "2026-01-01",
      anchorBalance: 200000,
      movements: [{ date: "2026-03-01", type: "WITHDRAWAL", amount: 50000 }],
    },
    "2026-06-01"
  );
  ok("withdrawal reduces, still accrues", v.balance > 150000 && v.balance < 165000, `balance=${v.balance.toFixed(2)}`);
  ok("net deposits negative", v.netDeposits === -50000, `net=${v.netDeposits}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
