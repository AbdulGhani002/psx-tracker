import { buildLots, summariseCgt, previewSell } from "../lib/calculations/lots";
import type { Transaction } from "../lib/types";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}  ${d}`); };

function tx(p: Partial<Transaction>): Transaction {
  return {
    _id: Math.random().toString(36), symbol: "X", type: "BUY", date: "2024-01-01",
    shares: 0, pricePerShare: 0, totalAmount: 0, fees: 0, netAmount: 0, notes: "", ratio: "",
    createdAt: "", updatedAt: "", ...p,
  } as Transaction;
}

console.log("=== FIFO disposal math ===");
{
  const txs = [
    tx({ type: "BUY", date: "2024-01-01", shares: 100, netAmount: 1000 }),  // 10/sh
    tx({ type: "BUY", date: "2024-06-01", shares: 100, netAmount: 2000 }),  // 20/sh
    tx({ type: "SELL", date: "2025-03-01", shares: -150, netAmount: 4500 }),// 30/sh
  ];
  const { openLots, disposals } = buildLots("X", txs);
  const totalGain = disposals.reduce((s, d) => s + d.gain, 0);
  // 100 from lot1: proceeds 3000 - cost 1000 = 2000; 50 from lot2: 1500 - 1000 = 500. total 2500.
  ok("total gain = 2500", Math.abs(totalGain - 2500) < 1e-6, `gain=${totalGain}`);
  ok("2 disposals", disposals.length === 2, `n=${disposals.length}`);
  ok("open lot 50 sh remain @20", openLots.length === 1 && Math.abs(openLots[0].shares - 50) < 1e-6 && Math.abs(openLots[0].costPerShare - 20) < 1e-6, JSON.stringify(openLots));
  ok("first disposal long-term (>365d)", disposals[0].longTerm === true, `days=${disposals[0].holdingDays}`);
  ok("second disposal short-term", disposals[1].longTerm === false, `days=${disposals[1].holdingDays}`);
}

console.log("\n=== CGT summary @15% ===");
{
  const txs = [
    tx({ type: "BUY", date: "2024-01-01", shares: 100, netAmount: 1000 }),
    tx({ type: "SELL", date: "2025-03-01", shares: -100, netAmount: 1500 }), // gain 500
  ];
  const { disposals } = buildLots("X", txs);
  const cgt = summariseCgt(disposals, 15);
  ok("net gain 500", Math.abs(cgt.netGain - 500) < 1e-6, `net=${cgt.netGain}`);
  ok("CGT = 75 (15% of 500)", Math.abs(cgt.cgt - 75) < 1e-6, `cgt=${cgt.cgt}`);
}

console.log("\n=== loss offsets gain in same year ===");
{
  const txs = [
    tx({ type: "BUY", date: "2024-07-10", shares: 100, netAmount: 1000 }),
    tx({ type: "BUY", date: "2024-07-10", shares: 100, netAmount: 3000 }),
    tx({ type: "SELL", date: "2025-01-10", shares: -100, netAmount: 1500 }), // FIFO lot1: +500
    tx({ type: "SELL", date: "2025-02-10", shares: -100, netAmount: 2000 }), // lot2: -1000
  ];
  const { disposals } = buildLots("X", txs);
  const cgt = summariseCgt(disposals, 15);
  ok("net gain = -500", Math.abs(cgt.netGain - (-500)) < 1e-6, `net=${cgt.netGain}`);
  ok("CGT = 0 (net loss)", cgt.cgt === 0, `cgt=${cgt.cgt}`);
}

console.log("\n=== SPLIT rescales lots ===");
{
  const txs = [
    tx({ type: "BUY", date: "2024-01-01", shares: 100, netAmount: 1000 }), // 10/sh
    tx({ type: "SPLIT", date: "2024-06-01", ratio: "1:2" }),               // 1 old -> 2 new
    tx({ type: "SELL", date: "2025-01-01", shares: -200, netAmount: 3000 }), // 200 sh now, 15/sh
  ];
  const { disposals } = buildLots("X", txs);
  // After split: 200 sh @ 5. Sell 200 @ 15 -> cost 1000, proceeds 3000, gain 2000.
  const g = disposals.reduce((s, d) => s + d.gain, 0);
  ok("split: gain 2000", Math.abs(g - 2000) < 1e-6, `gain=${g}`);
}

console.log("\n=== pre-trade preview ===");
{
  const txs = [
    tx({ type: "BUY", date: "2024-01-01", shares: 100, netAmount: 1000 }),
    tx({ type: "BUY", date: "2024-06-01", shares: 100, netAmount: 2000 }),
  ];
  const { openLots } = buildLots("X", txs);
  const pv = previewSell(openLots, 120, 25, 15);
  // 100@10 + 20@20: cost 1000+400=1400, proceeds 3000, gain 1600. cgt 240.
  ok("preview gain 1600", Math.abs(pv.totalGain - 1600) < 1e-6, `gain=${pv.totalGain}`);
  ok("preview cgt 240", Math.abs(pv.estCgt - 240) < 1e-6, `cgt=${pv.estCgt}`);
  ok("not insufficient", pv.insufficient === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
