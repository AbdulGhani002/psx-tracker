import { computeRebalance } from "../lib/calculations/rebalance";
import type { PositionRow } from "../lib/calculations/portfolio";

function pos(symbol: string, price: number, shares: number, targetPct: number): PositionRow {
  const marketValue = price * shares;
  return {
    symbol, name: symbol, sector: "Test", shariaCompliant: false,
    shares, avgCost: price, currentPrice: price, totalCost: marketValue,
    marketValue, unrealizedPL: 0, unrealizedPct: 0, realizedPL: 0,
    dividendsReceived: 0, totalReturn: 0, totalReturnPct: 0,
    currentPercent: 0, targetPercent: targetPct, deviation: 0,
  };
}

// Allocation percents are computed by buildPositionRows normally; for the test
// we set currentPercent manually via the marketValue ratio.
function withPercents(positions: PositionRow[]): PositionRow[] {
  const total = positions.reduce((s, p) => s + p.marketValue, 0);
  return positions.map((p) => ({ ...p, currentPercent: total > 0 ? (p.marketValue / total) * 100 : 0 }));
}

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`); }
}

console.log("=== Test 1: leftover gets deployed below cheapest share ===");
{
  const positions = withPercents([
    pos("AHCL", 14, 1000, 20),   // 14,000
    pos("HUBC", 215, 50, 20),    // 10,750
    pos("MEBL", 480, 30, 20),    // 14,400
    pos("MUREB", 950, 20, 20),   // 19,000
    pos("PTL", 51, 200, 20),     // 10,200
  ]);
  const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const r = computeRebalance({
    positions, freshCash: 280000, cashFromBalance: 0, totalValue,
    allowSelling: false, orderPrices: {}, redistribute: true,
  });
  const cheapest = Math.min(...r.rows.map((x) => x.orderPrice));
  check("cash remaining < cheapest share price", r.cashAfter < cheapest, `cashAfter=${r.cashAfter.toFixed(2)} cheapest=${cheapest}`);
  check("cash remaining >= 0", r.cashAfter >= -1e-6, `cashAfter=${r.cashAfter}`);
  check("deployed <= cash in", r.deployed <= 280000 + 1e-6, `deployed=${r.deployed}`);
  console.log(`  deployed=${r.deployed.toFixed(2)} leftoverUsed=${r.leftoverDeployed.toFixed(2)} cashAfter=${r.cashAfter.toFixed(2)}`);
}

console.log("\n=== Test 2: custom order price buys more shares ===");
{
  const positions = withPercents([
    pos("AHCL", 14, 1000, 50),
    pos("HUBC", 215, 50, 50),
  ]);
  const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const atMarket = computeRebalance({
    positions, freshCash: 100000, cashFromBalance: 0, totalValue,
    allowSelling: false, orderPrices: {}, redistribute: false,
  });
  const atLimit = computeRebalance({
    positions, freshCash: 100000, cashFromBalance: 0, totalValue,
    allowSelling: false, orderPrices: { AHCL: 12 }, redistribute: false,
  });
  const ahclMkt = atMarket.rows.find((x) => x.symbol === "AHCL")!.deltaShares;
  const ahclLim = atLimit.rows.find((x) => x.symbol === "AHCL")!.deltaShares;
  check("lower order price => more AHCL shares", ahclLim > ahclMkt, `mkt=${ahclMkt} limit=${ahclLim}`);
  check("AHCL action priced at order price", Math.abs(atLimit.rows.find((x) => x.symbol === "AHCL")!.actionRupees - ahclLim * 12) < 1e-6);
}

console.log("\n=== Test 3: termination + no over-budget with tiny prices ===");
{
  const positions = withPercents([
    pos("PENNY", 0.5, 100, 50),
    pos("BIG", 5000, 1, 50),
  ]);
  const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const r = computeRebalance({
    positions, freshCash: 50000, cashFromBalance: 0, totalValue,
    allowSelling: false, orderPrices: {}, redistribute: true,
  });
  check("terminates and deploys", r.deployed > 0);
  check("cash remaining >= 0", r.cashAfter >= -1e-6, `cashAfter=${r.cashAfter}`);
  check("cash remaining < cheapest (0.5)", r.cashAfter < 0.5 + 1e-6, `cashAfter=${r.cashAfter.toFixed(2)}`);
  console.log(`  deployed=${r.deployed.toFixed(2)} cashAfter=${r.cashAfter.toFixed(2)}`);
}

console.log("\n=== Test 4: order price 0/blank falls back to live ===");
{
  const positions = withPercents([pos("AHCL", 14, 100, 100)]);
  const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const r = computeRebalance({
    positions, freshCash: 14000, cashFromBalance: 0, totalValue,
    allowSelling: false, orderPrices: { AHCL: "" }, redistribute: true,
  });
  check("uses live price 14 when blank", r.rows[0].orderPrice === 14, `orderPrice=${r.rows[0].orderPrice}`);
}

console.log("\n=== Test 5: no redistribute leaves rounding leftover ===");
{
  const positions = withPercents([
    pos("AHCL", 14, 1000, 50),
    pos("MUREB", 950, 20, 50),
  ]);
  const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const off = computeRebalance({
    positions, freshCash: 100000, cashFromBalance: 0, totalValue,
    allowSelling: false, orderPrices: {}, redistribute: false,
  });
  const on = computeRebalance({
    positions, freshCash: 100000, cashFromBalance: 0, totalValue,
    allowSelling: false, orderPrices: {}, redistribute: true,
  });
  check("redistribute on deploys >= off", on.deployed >= off.deployed, `off=${off.deployed} on=${on.deployed}`);
  check("redistribute on leaves <= off leftover", on.cashAfter <= off.cashAfter + 1e-6, `off=${off.cashAfter} on=${on.cashAfter}`);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
