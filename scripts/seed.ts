import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { HoldingModel, TransactionModel, TargetAllocationModel } from "../lib/models";
import { PSX_SECTOR_MAP } from "../lib/sectors";

// Minimal .env.local loader so we don't take a dotenv dep just for seeding.
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const SEED_HOLDINGS = [
  { symbol: "MUREB", shares: 150,   targetPct: 12 },
  { symbol: "MEBL",  shares: 524,   targetPct: 18 },
  { symbol: "AHCL",  shares: 15176, targetPct: 8 },
  { symbol: "HUBC",  shares: 591,   targetPct: 22 },
  { symbol: "PTL",   shares: 1722,  targetPct: 10 },
];

async function main() {
  const uri = process.env.MONGODB_URI ?? "mongodb://localhost:27017/portfolio_tracker";
  await mongoose.connect(uri);
  console.log(`[seed] connected to ${uri}`);

  await HoldingModel.deleteMany({});
  await TransactionModel.deleteMany({});
  await TargetAllocationModel.deleteMany({});
  console.log("[seed] cleared holdings, transactions, targets");

  for (const h of SEED_HOLDINGS) {
    const info = PSX_SECTOR_MAP[h.symbol];
    await HoldingModel.create({
      symbol: h.symbol,
      name: info?.name ?? h.symbol,
      sector: info?.sector ?? "Other",
      shariaCompliant: info?.shariaCompliant ?? false,
      currentShares: h.shares,
      avgCostBasis: 0,
      totalCost: 0,
      realizedPL: 0,
      totalDividendsReceived: 0,
      targetAllocationPercent: h.targetPct,
      notes: "",
    });
    await TargetAllocationModel.create({
      symbol: h.symbol,
      targetPercent: h.targetPct,
      rebalanceBand: 3,
      rationale: "Initial target set during seed.",
    });
    console.log(`[seed]   ${h.symbol}: ${h.shares} shares, target ${h.targetPct}%`);
  }

  console.log("[seed] done. Run the app and add real transactions via the UI.");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
