// Standalone seed script that runs inside the deployed bundle on the VPS.
// Loads MONGODB_URI from .env.local in the cwd.
const fs = require("fs");
const path = require("path");
const mongoose = require("./node_modules/mongoose");

const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const SEED = [
  { symbol: "MUREB", name: "Murree Brewery Company Limited", sector: "Food & Personal Care", shariaCompliant: false, shares: 150, target: 12 },
  { symbol: "MEBL",  name: "Meezan Bank Limited",            sector: "Commercial Banks",     shariaCompliant: true,  shares: 524, target: 18 },
  { symbol: "AHCL",  name: "Asia Insurance Company Limited", sector: "Insurance",            shariaCompliant: false, shares: 15176, target: 8 },
  { symbol: "HUBC",  name: "The Hub Power Company Limited",  sector: "Power Generation",     shariaCompliant: true,  shares: 591, target: 22 },
  { symbol: "PTL",   name: "Pakistan Telecommunication Co.", sector: "Telecommunication",    shariaCompliant: false, shares: 1722, target: 10 },
];

const HoldingSchema = new mongoose.Schema({
  symbol: { type: String, unique: true, uppercase: true, trim: true },
  name: String, sector: String, shariaCompliant: Boolean,
  currentShares: { type: Number, default: 0 },
  avgCostBasis: { type: Number, default: 0 },
  totalCost: { type: Number, default: 0 },
  realizedPL: { type: Number, default: 0 },
  totalDividendsReceived: { type: Number, default: 0 },
  targetAllocationPercent: { type: Number, default: 0 },
  notes: { type: String, default: "" },
}, { timestamps: true });

const TargetSchema = new mongoose.Schema({
  symbol: { type: String, unique: true, uppercase: true },
  targetPercent: Number,
  rebalanceBand: { type: Number, default: 3 },
  rationale: String,
}, { timestamps: true });

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error("MONGODB_URI not set"); process.exit(1); }
  await mongoose.connect(uri);
  console.log("connected to", uri.replace(/:[^@]+@/, ":****@"));
  const Holding = mongoose.model("Holding", HoldingSchema);
  const Target = mongoose.model("TargetAllocation", TargetSchema);
  await Holding.deleteMany({});
  await Target.deleteMany({});
  for (const s of SEED) {
    await Holding.create({
      symbol: s.symbol, name: s.name, sector: s.sector, shariaCompliant: s.shariaCompliant,
      currentShares: s.shares, targetAllocationPercent: s.target,
    });
    await Target.create({ symbol: s.symbol, targetPercent: s.target, rebalanceBand: 3, rationale: "Initial seed." });
    console.log("seeded", s.symbol, s.shares + " shares, target " + s.target + "%");
  }
  await mongoose.disconnect();
  console.log("done");
})().catch((e) => { console.error(e); process.exit(1); });
