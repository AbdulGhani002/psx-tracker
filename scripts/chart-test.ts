// Render a couple of real charts to disk so the renderer can be looked at.
//   npx tsx scripts/chart-test.ts <outdir>
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fetchEodBars, type EodBar } from "../lib/timeseries/psx-eod";
import { renderPriceChart, sma } from "../lib/charts/price-chart";
import { readTrend } from "../lib/quant/features";

const CACHE = process.env.QUANT_CACHE || join(process.env.TEMP || process.env.TMP || ".", "psx-quant-cache");
async function bars(sym: string): Promise<EodBar[]> {
  mkdirSync(CACHE, { recursive: true });
  const f = join(CACHE, sym + ".json");
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  const b = await fetchEodBars(sym);
  if (b.length > 0) writeFileSync(f, JSON.stringify(b));
  return b;
}

async function main() {
  const out = process.argv[2] || ".";
  mkdirSync(out, { recursive: true });
  const jobs: Array<{ sym: string; title: string; buy?: { low: number | null; high: number | null }; sell?: { low: number | null; high: number | null }; cost?: number }> = [
    { sym: "KSE100", title: "KSE-100" },
    { sym: "MEBL", title: "MEBL Meezan Bank", buy: { low: 540, high: 570 }, sell: { low: 700, high: null }, cost: 538.31 },
    { sym: "PTL", title: "PTL Panther Tyres", buy: { low: 50, high: 55 }, cost: 53.69 },
  ];
  for (const j of jobs) {
    const all = await bars(j.sym);
    const closes = all.map((b) => b.close);
    const m50 = sma(closes, 50), m200 = sma(closes, 200);
    const n = 260; // about a year
    const from = Math.max(0, all.length - n);
    const window = all.slice(from);
    const trend = readTrend(all);
    const last = window[window.length - 1];
    const prev = window[window.length - 2];
    const chg = prev ? ((last.close / prev.close - 1) * 100) : 0;
    const png = renderPriceChart({
      title: j.title,
      subtitle: trend ? trend.short : undefined,
      bars: window,
      ma50: m50.slice(from),
      ma200: m200.slice(from),
      buyZone: j.buy,
      sellZone: j.sell,
      avgCost: j.cost,
      footer: `LAST ${last.close.toFixed(2)}  ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}% ON THE DAY`,
    });
    const f = join(out, j.sym + ".png");
    writeFileSync(f, png);
    console.log(`${j.sym}: ${png.length} bytes -> ${f}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
