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

function withPercents(positions: PositionRow[]): PositionRow[] {
  const total = positions.reduce((s, p) => s + p.marketValue, 0);
  return positions.map((p) => ({ ...p, currentPercent: total > 0 ? (p.marketValue / total) * 100 : 0 }));
}

let vulnCount = 0;

console.log("=== ATTACK 1: Custom orderPrice flows through greedy ===");
{
  const positions = withPercents([
    pos("A", 100, 10, 50),
    pos("B", 100, 10, 50),
  ]);
  const totalValue = 2000;
  const r = computeRebalance({
    positions, freshCash: 1000, cashFromBalance: 0, totalValue,
    allowSelling: false, 
    orderPrices: { A: 50, B: 100 },
    redistribute: true,
  });
  const a = r.rows.find(x => x.symbol === "A")!;
  const b = r.rows.find(x => x.symbol === "B")!;
  console.log(`A: orderPrice=${a.orderPrice}, deltaShares=${a.deltaShares}, actionRupees=${a.actionRupees}, finalValue=${a.finalValue}`);
  console.log(`B: orderPrice=${b.orderPrice}, deltaShares=${b.deltaShares}, actionRupees=${b.actionRupees}, finalValue=${b.finalValue}`);
  console.log(`cashAfter=${r.cashAfter.toFixed(2)}, deployed=${r.deployed}`);
  // CHECK: Did greedy use custom price? A is cheaper (50 vs 100) so should get more.
  // A's finalValue should be higher than at market price.
}

console.log("\n=== ATTACK 2: targetPct=0 excluded from greedy ===");
{
  const positions = withPercents([
    pos("HOLD", 100, 10, 0),
    pos("BUY", 100, 10, 100),
  ]);
  const totalValue = 2000;
  const r = computeRebalance({
    positions, freshCash: 2000, cashFromBalance: 0, totalValue,
    allowSelling: false,
    orderPrices: {},
    redistribute: true,
  });
  const hold = r.rows.find(x => x.symbol === "HOLD")!;
  const buy = r.rows.find(x => x.symbol === "BUY")!;
  console.log(`HOLD: action=${hold.action}, deltaShares=${hold.deltaShares}, finalValue=${hold.finalValue}`);
  console.log(`BUY: action=${buy.action}, deltaShares=${buy.deltaShares}, finalValue=${buy.finalValue}`);
  if (hold.deltaShares !== 0) {
    console.log("VULN: Position with targetPct=0 got deltaShares!");
    vulnCount++;
  }
}

console.log("\n=== ATTACK 3: AllowSelling=false with budget scaling ===");
{
  const positions = withPercents([
    pos("A", 100, 5, 50),
    pos("B", 100, 5, 50),
  ]);
  const totalValue = 1000;
  const r = computeRebalance({
    positions, freshCash: 500, cashFromBalance: 0, totalValue,
    allowSelling: false,
    orderPrices: {},
    redistribute: false,
  });
  console.log(`deployed=${r.deployed}, cashAfter=${r.cashAfter}`);
}

console.log("\n=== ATTACK 4: Sells reduce below zero ===");
{
  const positions = withPercents([
    pos("A", 100, 1, 0),
    pos("B", 100, 1, 100),
  ]);
  const totalValue = 200;
  const r = computeRebalance({
    positions, freshCash: 0, cashFromBalance: 0, totalValue,
    allowSelling: true,
    orderPrices: {},
    redistribute: false,
  });
  const a = r.rows.find(x => x.symbol === "A")!;
  console.log(`A: currentValue=${a.currentValue}, targetValue=${a.targetValue}, deltaShares=${a.deltaShares}, finalValue=${a.finalValue}`);
  if (a.finalValue < -1e-6) {
    console.log("VULN: finalValue went negative!");
    vulnCount++;
  }
}

console.log("\n=== ATTACK 5: Floating point cashAfter negative ===");
{
  const positions = withPercents([
    pos("A", 3, 100, 100),
  ]);
  const totalValue = 300;
  const r = computeRebalance({
    positions, freshCash: 450, cashFromBalance: 0, totalValue,
    allowSelling: false,
    orderPrices: {},
    redistribute: true,
  });
  console.log(`cashAfter=${r.cashAfter.toFixed(6)}`);
  if (r.cashAfter < -1e-6) {
    console.log("VULN: cashAfter < 0!");
    vulnCount++;
  }
  if (r.cashAfter >= 3) {
    console.log("WARN: cashAfter >= cheapest share (didn't buy another)");
  }
}

console.log("\n=== ATTACK 6: All-HOLD portfolio ===");
{
  const positions = withPercents([
    pos("A", 100, 10, 0),
    pos("B", 200, 5, 0),
  ]);
  const totalValue = 2000;
  const r = computeRebalance({
    positions, freshCash: 1000, cashFromBalance: 0, totalValue,
    allowSelling: false,
    orderPrices: {},
    redistribute: true,
  });
  console.log(`cashAfter=${r.cashAfter}, leftoverDeployed=${r.leftoverDeployed}`);
  if (r.leftoverDeployed > 1e-6) {
    console.log("VULN: Deployed to 0% target positions!");
    vulnCount++;
  }
}

console.log("\n=== ATTACK 7: Concentration cap warning ===");
{
  const positions = withPercents([
    pos("MEGA", 1000, 1, 95),
    pos("SMALL", 10, 10, 5),
  ]);
  const totalValue = 1100;
  const r = computeRebalance({
    positions, freshCash: 0, cashFromBalance: 0, totalValue,
    allowSelling: false,
    orderPrices: {},
    redistribute: false,
    concentrationCap: 90,
  });
  console.log(`MEGA finalPct=${r.rows[0].finalPct.toFixed(1)}%, warnings=${r.warnings.length}`);
  const hasWarn = r.warnings.some(w => w.includes("MEGA") && w.includes("concentration"));
  if (!hasWarn && r.rows[0].finalPct > 90) {
    console.log("VULN: No concentration cap warning!");
    vulnCount++;
  }
}

console.log("\n=== ATTACK 8: Scaling then greedy double-count ===");
{
  const positions = withPercents([
    pos("A", 100, 1, 50),
    pos("B", 100, 1, 50),
  ]);
  const totalValue = 200;
  const r = computeRebalance({
    positions, freshCash: 100, cashFromBalance: 0, totalValue,
    allowSelling: false,
    orderPrices: {},
    redistribute: true,
  });
  console.log(`deployed=${r.deployed}, cashAfter=${r.cashAfter}`);
  // Both scaled down, greedy then tries to deploy leftover.
  // Check: cashAfter should be within [0, minPrice)
}

console.log("\n=== ATTACK 9: Greedy loop doesn't spend more than available ===");
{
  const positions = withPercents([
    pos("A", 10, 10, 50),
    pos("B", 100, 1, 50),
  ]);
  const totalValue = 200;
  const r = computeRebalance({
    positions, freshCash: 150, cashFromBalance: 0, totalValue,
    allowSelling: false,
    orderPrices: {},
    redistribute: true,
  });
  console.log(`cashIn=150, deployed=${r.deployed}, cashAfter=${r.cashAfter}`);
  if (r.deployed > 150 + 1e-6) {
    console.log("VULN: Deployed more than available cash!");
    vulnCount++;
  }
  if (r.cashAfter < -1e-6) {
    console.log("VULN: cashAfter < 0!");
    vulnCount++;
  }
}

console.log("\n=== ATTACK 10: orderPrice fallback in greedy loop ===");
{
  const positions = withPercents([
    pos("A", 100, 10, 50),
    pos("B", 50, 10, 50),
  ]);
  const totalValue = 1500;
  const r = computeRebalance({
    positions, freshCash: 500, cashFromBalance: 0, totalValue,
    allowSelling: false,
    orderPrices: { A: "" }, // blank - should use live price 100
    redistribute: true,
  });
  const a = r.rows.find(x => x.symbol === "A")!;
  console.log(`A orderPrice=${a.orderPrice}, expected=100`);
  if (Math.abs(a.orderPrice - 100) > 1e-6) {
    console.log("VULN: blank orderPrice didn't fallback to live price!");
    vulnCount++;
  }
}

console.log(`\n=== VULNERABILITIES FOUND: ${vulnCount} ===`);
if (vulnCount > 0) process.exit(1);
