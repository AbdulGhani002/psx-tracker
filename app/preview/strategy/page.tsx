import { notFound } from "next/navigation";
import { StrategyView } from "@/app/strategy/StrategyView";
import { strategyPlan, type Rates, type StrategyInput } from "@/lib/strategy/plan";
import { buyZones, type Close } from "@/lib/strategy/zones";
import { FixedIncomeManager } from "@/app/funds/FixedIncomeManager";
import { Card } from "@/components/ui/Card";
import { valueFixedIncome, tbillCost, type FixedIncomeHolding } from "@/lib/fixed-income/value";
import { buyPick, sellPick } from "@/lib/strategy/picks";
import { edgeAt } from "@/lib/macro/learn";

// The tested record's tenths (3 months against the market), as the model
// carries them.
const CAL = [-0.03, -0.011, -0.008, 0.002, 0.005, 0.012, 0.011, 0.013, 0.015, 0.02].map((rel3, d) => ({ lo: d / 10, hi: (d + 1) / 10, rel3, hit: 0.5, n: 3000 }));
import type { ResearchRow, Research, StrategyView as StrategyData } from "@/lib/strategy/data";

// The strategy page on sample figures, for looking at the design on a
// machine with no database. Development only.
export const dynamic = "force-dynamic";

// A made-up KSE-100: a rise, a dip to about 148,000 in December, a run to
// 198,500 in June, and the fall since; a small wobble on every day.
function sampleKse(): Close[] {
  const legs: Array<[string, number]> = [["2025-01-01", 112_000], ["2025-10-15", 162_000], ["2025-12-10", 148_000], ["2026-06-24", 198_500], ["2026-08-12", 166_000], ["2026-08-28", 172_500], ["2026-10-09", 156_400]];
  const out: Close[] = [];
  for (let k = 0; k < legs.length - 1; k++) {
    const [d0, v0] = legs[k], [d1, v1] = legs[k + 1];
    const t0 = Date.parse(d0 + "T00:00:00Z"), t1 = Date.parse(d1 + "T00:00:00Z");
    for (let t = t0; t < t1 || (k === legs.length - 2 && t === t1); t += 86400000) {
      const day = new Date(t).getUTCDay();
      if (day === 0 || day === 6) continue;
      const f = (t - t0) / (t1 - t0);
      const wobble = t === t1 || t === t0 ? 1 : 1 + 0.006 * Math.sin(t / 86400000 / 2.3) + 0.004 * Math.sin(t / 86400000 / 0.7);
      out.push({ date: new Date(t).toISOString().slice(0, 10), close: Math.round((v0 + (v1 - v0) * f) * wobble) });
    }
  }
  return out;
}

// A researched share on made-up figures: price, model rank, P/E now and its
// usual at today's rate, earnings, and the 20-day zones around the price.
function row(symbol: string, name: string, sector: string, price: number, pctile: number | null, pe: number | null, fairPe: number | null, held = false, thin = false): ResearchRow {
  const zone = { buyLow: Math.round(price * 0.93), buyHigh: Math.round(price * 0.96), fails: Math.round(price * 0.9), sellLow: Math.round(price * 1.05), sellHigh: Math.round(price * 1.09) };
  const edge = pctile == null ? null : edgeAt(CAL, pctile);
  const input = { symbol, price, edge, thin, zone };
  return {
    symbol, name, sector, held, price, pctile, thin, pe, fairPe,
    peLo: pe ? +(pe * 0.45).toFixed(1) : null, peHi: pe ? +(pe * 1.1).toFixed(1) : null,
    june: pe ? [["2022", +(pe * 0.6).toFixed(1)], ["2023", +(pe * 0.45).toFixed(1)], ["2024", +(pe * 0.55).toFixed(1)], ["2025", +(pe * 0.8).toFixed(1)], ["2026", +(pe * 0.98).toFixed(1)]] : [],
    dividendYieldPct: pe ? 4 + (symbol.length % 4) * 1.5 : null, roePct: pe ? 18 + (symbol.charCodeAt(0) % 12) : null, grade: pe ? "B" : null,
    yieldJune: pe ? [["2023", 9.4], ["2024", 8.1], ["2025", 6.2], ["2026", 5.5]] : [], edge,
    ret12: 0.12 + (symbol.charCodeAt(1) % 9) / 20 - 0.2, offHigh: -0.08, zone,
    buy: buyPick(input), sell: held ? sellPick(input) : null,
  };
}

function sampleResearch(): Research {
  const banks = [row("MEBL", "Meezan Bank Limited", "COMMERCIAL BANKS", 518, 0.72, 10.4, 7.1, true), row("BAHL", "Bank AL Habib Limited", "COMMERCIAL BANKS", 172, 0.83, 5.9, 6.4), row("UBL", "United Bank Limited", "COMMERCIAL BANKS", 395, 0.64, 7.8, 6.9), row("HBL", "Habib Bank Limited", "COMMERCIAL BANKS", 268, 0.41, 6.1, 5.8), row("BOP", "The Bank of Punjab", "COMMERCIAL BANKS", 16.2, 0.18, 4.9, 4.1), row("SBL", "Samba Bank Limited", "COMMERCIAL BANKS", 11.4, 0.5, 9.2, 8.8, false, true)];
  const cement = [row("LUCK", "Lucky Cement Limited", "CEMENT", 407, 0.58, 12.8, 8.9, true), row("FCCL", "Fauji Cement Company Limited", "CEMENT", 52.3, 0.77, 8.1, 7.4), row("CHCC", "Cherat Cement Company Limited", "CEMENT", 288, 0.69, 7.2, 8.6), row("DGKC", "D.G. Khan Cement Company Limited", "CEMENT", 196, 0.22, 21.5, 11.2)];
  const held = [row("HINOON", "Highnoon Laboratories Limited", "PHARMACEUTICALS", 912, 0.81, 14.1, 12.2, true, true), row("PTL", "Panther Tyres Limited", "AUTOMOBILE PARTS & ACCESSORIES", 61.2, 0.12, 11.3, 9.5, true)];
  const order = { buy: 0, "buy-at": 1, wait: 2, dear: 3, avoid: 4, thin: 5, unknown: 6 } as const;
  const sort = (rs: ResearchRow[]) => [...rs].sort((a, b) => order[a.buy.verdict] - order[b.buy.verdict] || (b.pctile ?? -1) - (a.pctile ?? -1));
  const all = [...banks, ...cement];
  return {
    asOf: "2026-10-08",
    rateNow: 11.5,
    sectors: [
      { sector: "COMMERCIAL BANKS", name: "Commercial Banks", pctile: 0.78, rank: 4, peNow: 6.8, peFair: 6.6, rows: sort(banks), quiet: 3 },
      { sector: "CEMENT", name: "Cement", pctile: 0.52, rank: 11, peNow: 10.2, peFair: 8.7, rows: sort(cement), quiet: 9 },
    ],
    buys: sort(all.filter((r) => r.buy.verdict === "buy" || r.buy.verdict === "buy-at")),
    held: [...all, ...held].filter((r) => r.held),
    watched: { sectors: 2, shares: 48 },
  };
}

function sampleMacro(): NonNullable<StrategyData["macro"]> {
  const timing = (cagr: number, maxDd: number) => ({ cagr, maxDd, n: 74, corr: 0.1 } as any);
  return {
    asOf: "2026-10-08",
    computedAt: "2026-10-11T10:00:00Z",
    rate: { now: 11.5 },
    learning: { calibration: CAL, tested: CAL, live: { outcomes: 0, signals: 482, since: "2026-10-08" }, value: { beta: 0.023, t: 1.85, n: 583, quarters: 11, from: "2023-12-31", to: "2026-06-30", holds: false } },
    model: {
      builtAt: "2026-10-11T10:11:00Z",
      trainedTo: "2026-06-30",
      universe: "each year's 120 most traded names on the exchange (2003 on)",
      record: { ic: 0.12, icT: 5.3, spread: 0.051, spreadT: 4.1, hit: 0.7, sectorIc: 0.145, sectorIcT: 3.5, months: 220, eras: [] } as any,
      baselines: [{ name: "Momentum", ic: 0.076, icT: 3.4, spread: 0.034, sectorIc: 0.113 }, { name: "Momentum and dividend yield", ic: 0.103, icT: 3.2, spread: 0.041, sectorIc: 0.148 }],
      sensitivities: { factors: ["oil", "rupee", "gold", "policy", "US stocks"], rows: [{ sector: "OIL & GAS EXPLORATION COMPANIES", beta: [0.12, 0.05, 0, 0.002, 0], t: [3.6, 1.1, 0.2, 0.4, 0.3], n: 200 }, { sector: "CEMENT", beta: [-0.12, -0.08, 0, -0.004, 0], t: [-3.9, -1.5, 0.1, -1.2, 0.5], n: 200 }, { sector: "COMMERCIAL BANKS", beta: [0, 0, 0, 0.012, 0], t: [0.3, 0.2, -0.5, 2.1, 0.1], n: 200 }] as any },
      timing: { trend: timing(0.212, -0.16), macro: timing(0.156, -0.53), analogs: timing(0.111, -0.82), always: timing(0.06, -0.82) },
      analogNames: ["policy", "realRate", "cpi", "oil12", "pkr12", "mktDd12"],
    },
    state: [11.5, 0.4, 11.1, -0.08, 0.02, -0.11],
    analogs: [
      { date: "2009-10-30", x: [12.5, 1.6, 10.9, 0.4, 0.05, -0.3], mkt3: 0.05, mkt6: 0.12, mkt12: 0.25, best: [["CEMENT", 0.1]], worst: [], dy: 7, distance: 0.6 },
      { date: "2011-08-31", x: [13.5, 0.6, 12.9, 0.1, 0.03, -0.12], mkt3: -0.04, mkt6: -0.02, mkt12: 0.18, best: [["COMMERCIAL BANKS", 0.05]], worst: [], dy: 8, distance: 0.8 },
      { date: "2008-05-30", x: [12, -5, 17, 0.9, 0.08, -0.08], mkt3: -0.2, mkt6: -0.45, mkt12: -0.5, best: [["FERTILIZER", 0.08]], worst: [], dy: 5, distance: 1.1 },
    ] as any,
    sectors: [
      { sector: "OIL & GAS EXPLORATION COMPANIES", name: "Oil & Gas Exploration Companies", score: 0.03, pctile: 0.95, n: 4, watched: false },
      { sector: "COMMERCIAL BANKS", name: "Commercial Banks", score: 0.02, pctile: 0.78, n: 14, watched: true },
      { sector: "CEMENT", name: "Cement", score: 0, pctile: 0.52, n: 10, watched: true },
    ],
  };
}

export default async function StrategyPreview({ searchParams }: { searchParams: Promise<{ full?: string; tab?: string }> }) {
  if (process.env.NODE_ENV === "production" || process.env.DEV_PREVIEW !== "1") notFound();
  const tab = (await searchParams).tab;
  const rates: Rates = { month: "2026-10", policyPct: 11.5, tbill3mPct: 11.6, tbill6mPct: 11.9, tbill12mPct: 11.99, sukukPct: 11.8, savingsPct: 10, moneyMarketPct: 10.6, inflationPct: 11.15, taxPct: 15 };
  const closes = sampleKse();
  const last = closes[closes.length - 1];
  const year = closes.slice(-252);
  const top = year.reduce((m, p) => (p.close > m.close ? p : m), year[0]);
  const ma = (k: number) => (k >= 199 ? closes.slice(k - 199, k + 1).reduce((s, p) => s + p.close, 0) / 200 : null);
  const chart = closes.map((p, k) => ({ ...p, ma200: ma(k) })).slice(-260);
  const zones = buyZones({ closes, model: { buyHigh: 153_800, buyLow: 150_200 }, pe: 8.4, tbillPct: rates.tbill12mPct });
  const input: StrategyInput = {
    today: "2026-10-11",
    profile: { risk: "balanced", horizon: "long" },
    kse: { level: last.close, high: top.close, highDate: top.date, ma200: ma(closes.length - 1) },
    market: { pe: 8.4, cape: 7.4, dividendYieldPct: 6.2 },
    rates,
    prevRates: { ...rates, month: "2026-09", policyPct: 12 },
    // ?full=1: everything in stocks, no cash recorded.
    book: (await searchParams).full === "1" ? { stocks: 2_065_000, equityFunds: 0, cashLike: 0, fixedIncome: 0 } : { stocks: 1_980_000, equityFunds: 0, cashLike: 650_000, fixedIncome: 500_000 },
    names: [
      { symbol: "MEBL", held: true, value: 450_000, grade: "A", quadrant: "premium", roeSpreadPp: 13.8, dividendYieldPct: 3.9, marginOfSafetyPct: 8 },
      { symbol: "HINOON", held: true, value: 500_000, grade: "A", quadrant: "premium", roeSpreadPp: 16.8, dividendYieldPct: 5.4, marginOfSafetyPct: 24 },
      { symbol: "PTL", held: true, value: 180_000, grade: "C", quadrant: "danger", roeSpreadPp: -3.1, dividendYieldPct: 8.2 },
      { symbol: "MARI", held: false, value: 0, grade: "B", quadrant: "compounder", roeSpreadPp: 12.9, dividendYieldPct: 12.5 },
      { symbol: "INDU", held: false, value: 0, grade: "A", quadrant: "compounder", roeSpreadPp: 12.4, dividendYieldPct: 9.1 },
      { symbol: "FABL", held: false, value: 0, grade: "B", quadrant: "compounder", roeSpreadPp: 1.9, dividendYieldPct: 13.2 },
    ],
    zones,
  };
  const plan = strategyPlan(input);
  const model = {
    date: "2026-10-09",
    state: "WEAK",
    names: {
      HINOON: { price: 912, buyLow: 842, buyHigh: 873, sellLow: 968, sellHigh: 1004, fails: 815, pctile: 0.81 },
      MARI: { price: 596, buyLow: 551, buyHigh: 572, sellLow: 628, sellHigh: 650, fails: 532, pctile: 0.74 },
      INDU: { price: 2_310, buyLow: 2_155, buyHigh: 2_228, sellLow: 2_430, sellHigh: 2_515, fails: 2_090, pctile: 0.66 },
    },
  };
  const s: StrategyData = { plan, rates, ratesEntered: true, profile: input.profile, kse: { ...input.kse!, asOf: last.date }, book: input.book, history: [rates, { ...rates, month: "2026-09", policyPct: 12, tbill12mPct: 12.4 }], chart, model, macro: sampleMacro(), research: sampleResearch() };
  const holdings: FixedIncomeHolding[] = [
    { kind: "tbill", name: "12M T-bill", face: 300_000, cost: tbillCost(300_000, 11.99, 365), purchaseDate: "2026-07-03", maturityDate: "2027-07-03", couponPct: 0, couponsPerYear: 0, taxPct: 15 },
    { kind: "tbill", name: "3M T-bill", face: 100_000, cost: tbillCost(100_000, 11.6, 91), purchaseDate: "2026-08-14", maturityDate: "2026-11-13", couponPct: 0, couponsPerYear: 0, taxPct: 15 },
    { kind: "sukuk", name: "GoP Ijara Sukuk 5Y", face: 100_000, cost: 99_200, purchaseDate: "2026-02-10", maturityDate: "2031-01-29", couponPct: 11.8, couponsPerYear: 2, taxPct: 15, pricePct: 100.4 },
  ];
  const rows = holdings.map((h, k) => ({ _id: String(k), ...h, pricePct: h.pricePct ?? null, notes: "", ...valueFixedIncome(h, "2026-10-11") }));
  return (
    <div>
      <StrategyView s={s} prefill={{ values: rates, sources: { policyPct: "SBP, 2026-09-11", inflationPct: "PBS CPI, 2026-08" }, entered: true }} tab={tab === "research" || tab === "model" ? tab : "plan"} />
      <Card className="mt-3" title="T-bills and sukuks" eyebrow="As on the Cash tab">
        <FixedIncomeManager rows={rows as any} taxPct={15} />
      </Card>
    </div>
  );
}
