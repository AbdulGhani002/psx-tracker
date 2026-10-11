import "server-only";
import { connectDb } from "@/lib/db";
import { FeedSnapshotModel, FundamentalModel, ShareEventModel, ShareSignalModel } from "@/lib/models";
import { loadQuantSnapshot } from "@/lib/quant/store";
import { equalWeightIndex } from "@/lib/quant/archive";
import { realisedVolPct, sigmaOverHorizon } from "@/lib/quant/features";
import { pathLevels, WALK_CURVE } from "@/lib/quant/projection";
import { getFeedSnapshot, saveFeedSnapshot, getInflationLive, getSbpRateSteps } from "@/lib/data";
import { sectorKey, displaySector } from "@/lib/calculations/sector-weights";
import symbols from "@/lib/psx-symbols.json";
import history from "./pk-history.json";
import { buildPanel, barAt, ranks, STOCK_NAMES, SECTOR_NAMES, SENS_NAMES, type PanelRow } from "./panel";
import { MACRO_NAMES, macroState, valueOn, type MacroInputs, type Point } from "./series";
import { predictMlp } from "./mlp";
import { analogs } from "./analytics";
import { epsOnToday, peHistory, usualPe, type PePoint } from "./valuation";
import { liveCalibration, blendCalibration, valueEffect, expectedEdge, yieldOn, type ValueEffect } from "./learn";
import { MACRO_MODEL_KEY, type MacroModel, type AnalogMonth, type Calibration } from "./artifact";
import type { EodBar } from "@/lib/timeseries/psx-eod";
import type { EventsSnapshot } from "@/lib/quant/event-record";

// The strategy model on today's data, for every share the server keeps
// prices for, worked out again after each close and every six hours:
//   the network the training machine sent (lib/macro/artifact.ts) scores the
//   150 most traded on the same panel code it learned on (the thinner ones
//   are scored on their own panel and marked thin);
//   each share's expected return against the market over the next three
//   months (lib/macro/learn.ts): its rank's, from the network's tested record
//   moved toward what the stored calls actually did, plus what its P/E
//   against its usual adds where the data says it adds anything;
//   sectors ranked by their members' scores;
//   each share's 20-day zones (the Model page's, on a plain walk), its year,
//   its P/E on each quarter's end beside today's and its usual with the
//   policy rate near today's (lib/macro/valuation.ts), and its dividend yield
//   now and on each 30 June from the dividend record (lib/models/ShareEvent);
//   and the macro state matched to the months most like it.
// Each close's reading of every share is stored (lib/models/ShareSignal);
// the outcome of each, three months on, is what the record learns from.

export type Zone = { buyLow: number; buyHigh: number; fails: number; sellLow: number; sellHigh: number };
export type NameLive = {
  symbol: string;
  sector: string;
  sectorName: string;
  price: number;
  date: string;
  score: number | null;
  pctile: number | null; // where its score sits among the liquid shares', 0 to 1
  thin: boolean; // outside the 150 most traded: the model did not learn on shares like it
  edge: number | null; // expected return against the market over 3 months
  valuePerDay: number | null; // rupees traded a day over the year
  ret12: number | null;
  offHigh: number | null;
  dividendYieldPct: number | null; // cash paid over the last year, at the prices then
  yieldJune: Array<[string, number]>; // the same on each 30 June
  zone: Zone | null;
};
export type PeLive = {
  now: number | null;
  eps: number | null; // the year's earnings on today's share count
  fair: number | null; // the P/E it has had with the policy rate near today's
  lo: number | null;
  hi: number | null;
  june: Array<[string, number]>; // the P/E on each 30 June
};
export type SectorScore = { sector: string; name: string; score: number; pctile: number; n: number };
export type Learning = {
  calibration: Calibration; // the record, moved toward the live outcomes
  tested: Calibration; // the record alone
  live: { outcomes: number; signals: number; since: string | null };
  value: ValueEffect;
};

export type MacroLive = {
  asOf: string;
  computedAt: string;
  model: Pick<MacroModel, "builtAt" | "trainedTo" | "universe" | "record" | "baselines" | "sensitivities" | "timing" | "analogNames">;
  names: NameLive[]; // scored best first, then the rest
  sectors: SectorScore[]; // best first
  state: Array<number | null>; // analogNames, now
  analogs: Array<AnalogMonth & { distance: number }>;
  pe: Record<string, PeLive>;
  rate: { now: number | null };
  learning: Learning;
};

const KEY = "macro:live:v3";
const TTL_MS = 6 * 60 * 60 * 1000;
const LIQUID = 150;
const AHEAD = 63; // sessions in three months
const NOT_STOCKS = new Set(["KSE100", "KMI30", "KSE30", "ALLSHR", "KSE100PR"]);
const listed = new Map((symbols as Array<{ symbol: string; sector: string; etf?: boolean }>).filter((s) => !s.etf).map((s) => [s.symbol, s.sector ? sectorKey(s.sector) : ""]));
const PANEL_NAMES: string[] = [...STOCK_NAMES, ...SECTOR_NAMES, ...MACRO_NAMES, ...SENS_NAMES];
const NO_FACTORS = () => ({ oil: null, pkr: null, gold: null, policy: null, spx: null });
// Before a model with its own record arrives: an even ladder of tenths.
const FLAT: Calibration = Array.from({ length: 10 }, (_, d) => ({ lo: d / 10, hi: (d + 1) / 10, rel3: (d - 4.5) * 0.008, hit: 0.5, n: 0 }));

async function seriesOf(keys: string[], last: number): Promise<Map<string, EodBar[]>> {
  const docs = (await FeedSnapshotModel.find({ key: { $in: keys.map((k) => `eod:bars:${k}`) } }, { key: 1, "data.bars": { $slice: -last } }).lean()) as any[];
  return new Map(docs.filter((d) => Array.isArray(d?.data?.bars)).map((d) => [String(d.key).slice("eod:bars:".length), d.data.bars as EodBar[]]));
}

// Quarter ends from 2019 to today.
function quarterEnds(to: string): string[] {
  const out: string[] = [];
  for (let y = 2019; y <= Number(to.slice(0, 4)); y++) for (const md of ["03-31", "06-30", "09-30", "12-31"]) if (`${y}-${md}` <= to) out.push(`${y}-${md}`);
  return out;
}

function zoneOf(b: EodBar[]): Zone | null {
  if (b.length < 61) return null;
  const vol = realisedVolPct(b, 60);
  if (vol == null) return null;
  const lv = pathLevels(b[b.length - 1].close, sigmaOverHorizon(vol / 100 / Math.sqrt(252), 20), [...WALK_CURVE], [...WALK_CURVE]);
  return { buyLow: lv.buyLow, buyHigh: lv.buyHigh, fails: lv.fails, sellLow: lv.sellLow, sellHigh: lv.sellHigh };
}

// The cash dividends of every share: the record kept on the server, or the
// archive's (quant:events) before that record exists.
async function dividendRecord(shares: string[]): Promise<Map<string, Array<{ date: string; yieldPct: number }>>> {
  const out = new Map<string, Array<{ date: string; yieldPct: number }>>(shares.map((s) => [s, []]));
  const kept = (await ShareEventModel.find({ kind: "cash", yieldPct: { $gt: 0 } }, { _id: 0, symbol: 1, date: 1, yieldPct: 1 }).lean()) as any[];
  if (kept.length > 0) {
    for (const e of kept) out.get(e.symbol)?.push({ date: e.date, yieldPct: e.yieldPct });
  } else {
    const events = await loadQuantSnapshot<EventsSnapshot>("quant:events").catch(() => null);
    for (const s of shares) out.set(s, (events?.symbols?.[s] ?? []).filter((r) => r[1] === "cash" && r[3] > 0).map((r) => ({ date: r[0], yieldPct: r[3] })));
  }
  for (const v of out.values()) v.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

async function computeMacroLive(): Promise<MacroLive | null> {
  await connectDb();
  const model = await loadQuantSnapshot<MacroModel>(MACRO_MODEL_KEY).catch(() => null);
  if (!model?.nets?.length) return null;

  // Every listed share kept, the last 1,400 sessions (back to before 2021).
  const keys = ((await FeedSnapshotModel.find({ key: /^eod:bars:[A-Z0-9]+$/ }, { key: 1 }).lean()) as any[]).map((d) => String(d.key).slice("eod:bars:".length)).filter((s) => listed.has(s) && !NOT_STOCKS.has(s));
  const all = await seriesOf(keys, 1400);
  if (all.size < 20) return null;
  const long = new Map([...all].filter(([, b]) => b.length >= 260));
  const market = equalWeightIndex(long, null, 10, true);
  const asOf = market[market.length - 1].date;

  const funds = (await FundamentalModel.find({ symbol: { $in: [...all.keys()] } }, { symbol: 1, annual: 1, fiscalYearEndMonth: 1, sharesOutstanding: 1, sector: 1 }).lean()) as any[];
  const fundOf = new Map(funds.map((f) => [f.symbol as string, f]));
  const sectorOf = (s: string) => listed.get(s) || (fundOf.get(s)?.sector ? sectorKey(fundOf.get(s).sector) : "") || null;
  const dividends = await dividendRecord([...all.keys()]);

  // The macro state now: SBP's history, its read after that, PBS inflation,
  // and the world series the server keeps.
  const [steps, cpi, world] = await Promise.all([getSbpRateSteps().catch(() => null), getInflationLive().catch(() => null), seriesOf(["MACRO:oil", "MACRO:gold", "MACRO:usdpkr", "MACRO:spx", "MACRO:em", "MACRO:dxy", "MACRO:us10y"], 600)]);
  const official = history.policy as Point[];
  const later = (steps?.steps ?? []).filter((x) => x.from > official[official.length - 1][0]).map((x) => [x.from, x.rate] as Point).sort((a, b) => a[0].localeCompare(b[0]));
  const policy = [...official, ...later];
  const pts = (k: string): Point[] => (world.get(k) ?? []).map((b) => [b.date, b.close] as Point);
  const inputs: MacroInputs = {
    policy,
    cpiMonthly: cpi?.history ?? [],
    cpiAnnual: history.cpiAnnual as Array<[number, number]>,
    gdpAnnual: history.gdpAnnual as Array<[number, number]>,
    oil: pts("MACRO:oil"), gold: pts("MACRO:gold"), usdpkr: pts("MACRO:usdpkr"), spx: pts("MACRO:spx"), em: pts("MACRO:em"), dxy: pts("MACRO:dxy"), us10y: pts("MACRO:us10y"),
    market: market.map((b) => [b.date, b.close] as Point),
  };

  // The liquid set: the most rupees traded a day over the year.
  const valuePerDay = new Map<string, number>();
  for (const [s, b] of all) {
    const y = b.slice(-250);
    valuePerDay.set(s, y.reduce((a, x) => a + (x.volume ?? 0) * ((x as any).vwap ?? x.close), 0) / Math.max(1, y.length));
  }
  const liquid = new Set([...long.keys()].sort((a, b) => (valuePerDay.get(b) ?? 0) - (valuePerDay.get(a) ?? 0)).slice(0, LIQUID));

  // The panel's last row for each share, as the network learned it: the
  // liquid shares among themselves, the thin ones among everyone.
  const monthEnds: string[] = [];
  for (let i = 0; i < market.length - 1; i++) if (market[i + 1].date.slice(0, 7) !== market[i].date.slice(0, 7)) monthEnds.push(market[i].date);
  monthEnds.push(asOf);
  const panelOf = (members: Set<string>) =>
    buildPanel({ bars: long, dividends, sectorOf, members: () => members, market, monthEnds: monthEnds.slice(-2), macro: (date) => macroState(date, inputs), factorMonthly: NO_FACTORS, factorPush: NO_FACTORS }).filter((r) => r.date === asOf);
  const liquidRows = panelOf(liquid);
  if (liquidRows.length < 20) return null;
  const thinRows = panelOf(new Set(long.keys())).filter((r) => !liquid.has(r.symbol));
  const idx = model.features.map((n) => PANEL_NAMES.indexOf(n));
  const scoreRow = (r: PanelRow) => model.nets.reduce((s, m) => s + predictMlp(m, idx.map((j) => r.x[j])), 0) / model.nets.length;
  const scores = new Map<string, number>();
  for (const r of [...liquidRows, ...thinRows]) scores.set(r.symbol, scoreRow(r));
  const liquidScores = liquidRows.map((r) => scores.get(r.symbol)!).sort((a, b) => a - b);
  const pctileOf = (v: number) => {
    let below = 0;
    for (const x of liquidScores) if (x < v) below++;
    return Math.min(1, liquidScores.length > 1 ? below / (liquidScores.length - 1) : 0.5);
  };

  // P/E on each quarter's end and today, on today's share count, and each
  // share's usual P/E with the policy rate near today's.
  const rateOn = (d: string) => valueOn(policy, d);
  const rateNow = rateOn(asOf);
  const quarters = quarterEnds(asOf);
  const priceOf = (b: EodBar[]) => (d: string) => {
    const i = barAt(b, d);
    return i >= 0 && Date.parse(d) - Date.parse(b[i].date) < 20 * 86400000 ? b[i].close : null;
  };
  const hist = new Map<string, { points: PePoint[]; now: number | null; eps: number | null }>();
  for (const [s, b] of all) {
    const f = fundOf.get(s);
    if (!f?.annual?.length) continue;
    const years = epsOnToday(f.annual, f.sharesOutstanding ?? null, f.fiscalYearEndMonth ?? null);
    if (!years.length) continue;
    const eps = years[years.length - 1].eps;
    const price = b[b.length - 1].close;
    hist.set(s, { points: peHistory(quarters, priceOf(b), years, rateOn), now: eps > 0 && price / eps <= 200 ? price / eps : null, eps });
  }
  const pe: Record<string, PeLive> = {};
  for (const [s, h] of hist) {
    const v = h.points.map((p) => p.pe);
    pe[s] = {
      now: h.now,
      eps: h.eps,
      fair: usualPe(h.points, rateNow),
      lo: v.length ? Math.min(...v) : null,
      hi: v.length ? Math.max(...v) : null,
      june: h.points.filter((p) => p.date.endsWith("-06-30")).map((p) => [p.date.slice(0, 4), Math.round(p.pe * 10) / 10] as [string, number]),
    };
  }

  // What a share did against the market over the three months after a date.
  const ahead = (b: EodBar[], d: string): number | null => {
    const i = barAt(b, d), m = barAt(market, d);
    if (i < 0 || m < 0 || m + AHEAD >= market.length) return null;
    const j = barAt(b, market[m + AHEAD].date);
    if (j <= i || !(b[i].close > 0) || !(market[m].close > 0)) return null;
    return b[j].close / b[i].close / (market[m + AHEAD].close / market[m].close) - 1;
  };

  // Whether P/E against its usual has told anything: at each quarter's end
  // with three months since, the reading against the usual of the readings
  // before it, and what the share did against the market next.
  const valueObs: Array<{ date: string; value: number; rel3: number }> = [];
  for (const [s, h] of hist) {
    const b = all.get(s)!;
    h.points.forEach((p, k) => {
      const usual = usualPe(h.points.slice(0, k), p.rate);
      const rel3 = usual ? ahead(b, p.date) : null;
      if (usual && rel3 != null) valueObs.push({ date: p.date, value: Math.log(p.pe / usual), rel3 });
    });
  }
  const value = valueEffect(valueObs);

  // What the stored calls did: each liquid share's reading three months or
  // more ago against what it did over the three months after.
  const cutoff = market.length > AHEAD ? market[market.length - 1 - AHEAD].date : null;
  const signals = await ShareSignalModel.estimatedDocumentCount().catch(() => 0);
  const first = ((await ShareSignalModel.findOne({}, { date: 1 }).sort({ date: 1 }).lean().catch(() => null)) as any)?.date ?? null;
  const done = cutoff ? ((await ShareSignalModel.find({ date: { $lte: cutoff }, thin: false, pctile: { $ne: null } }, { _id: 0, date: 1, symbol: 1, pctile: 1 }).lean().catch(() => [])) as any[]) : [];
  const outcomes: Array<{ pctile: number; rel3: number }> = [];
  for (const sgl of done) {
    const b = all.get(sgl.symbol);
    const r = b ? ahead(b, sgl.date) : null;
    if (r != null) outcomes.push({ pctile: sgl.pctile, rel3: r });
  }
  const tested = model.calibration ?? FLAT;
  const calibration = blendCalibration(tested, outcomes.length ? liveCalibration(outcomes) : null);

  const yearAgo = new Date(Date.parse(asOf + "T00:00:00Z") - 365 * 86400000).toISOString().slice(0, 10);
  const junes = quarters.filter((q) => q.endsWith("-06-30"));
  const names: NameLive[] = [...all].map(([s, b]) => {
    const last = b[b.length - 1];
    const y = b.slice(-250);
    const sc = scores.get(s) ?? null;
    const pctile = sc == null ? null : pctileOf(sc);
    const sector = sectorOf(s) ?? "";
    const p = pe[s];
    const divs = dividends.get(s) ?? [];
    return {
      symbol: s,
      sector,
      sectorName: sector ? displaySector(sector) : "Other",
      price: last.close,
      date: last.date,
      score: sc,
      pctile,
      thin: !liquid.has(s),
      edge: expectedEdge(calibration, pctile, p?.now != null && p.fair ? p.now / p.fair : null, value),
      valuePerDay: valuePerDay.get(s) ?? null,
      ret12: b.length > 250 ? last.close / b[b.length - 251].close - 1 : null,
      offHigh: y.length ? last.close / Math.max(...y.map((x) => x.close)) - 1 : null,
      dividendYieldPct: Math.round(divs.filter((d) => d.date > yearAgo).reduce((a, d) => a + d.yieldPct, 0) * 100) / 100,
      yieldJune: junes.filter((j) => b[0].date <= j).map((j) => [j.slice(0, 4), Math.round(yieldOn(divs, j) * 10) / 10] as [string, number]),
      zone: zoneOf(b),
    };
  });
  names.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));

  const bySector = new Map<string, number[]>();
  for (const n of names) if (n.sector && n.score != null && !n.thin) (bySector.get(n.sector) ?? bySector.set(n.sector, []).get(n.sector)!).push(n.score);
  const secs = [...bySector].filter(([, v]) => v.length >= 2).map(([sector, v]) => ({ sector, name: displaySector(sector), score: v.reduce((a, c) => a + c, 0) / v.length, n: v.length }));
  const secPct = ranks(secs.map((x) => x.score));
  const sectors: SectorScore[] = secs.map((x, k) => ({ ...x, pctile: secs.length > 1 ? secPct[k] : 0.5 })).sort((a, b) => b.score - a.score);

  // Times like now.
  const state = macroState(asOf, inputs);
  const now = model.analogNames.map((n) => state[MACRO_NAMES.indexOf(n as (typeof MACRO_NAMES)[number])]);
  const near = analogs(model.analogHistory.map((h) => ({ date: h.date, x: h.x })), { date: asOf, x: now.map((v) => (v == null ? NaN : v)) }, 6, 12);
  const histBy = new Map(model.analogHistory.map((h) => [h.date, h]));

  return {
    asOf,
    computedAt: new Date().toISOString(),
    model: { builtAt: model.builtAt, trainedTo: model.trainedTo, universe: model.universe, record: model.record, baselines: model.baselines, sensitivities: model.sensitivities, timing: model.timing, analogNames: model.analogNames },
    names,
    sectors,
    state: now,
    analogs: near.map((a) => ({ ...histBy.get(a.date)!, distance: a.distance })),
    pe,
    rate: { now: rateNow },
    learning: { calibration, tested, live: { outcomes: outcomes.length, signals, since: first }, value },
  };
}

// Each share's reading on the close, stored once per close (a later reading
// of the same close replaces it).
async function storeSignals(r: MacroLive): Promise<number> {
  const ops = r.names.map((n) => ({
    updateOne: {
      filter: { symbol: n.symbol, date: n.date },
      update: {
        $set: {
          sector: n.sector,
          price: n.price,
          score: n.score,
          pctile: n.pctile,
          thin: n.thin,
          pe: r.pe[n.symbol]?.now ?? null,
          usualPe: r.pe[n.symbol]?.fair ?? null,
          dividendYieldPct: n.dividendYieldPct,
          rate: r.rate.now,
          edge: n.edge,
          model: r.model.builtAt,
        },
      },
      upsert: true,
    },
  }));
  for (let i = 0; i < ops.length; i += 200) await ShareSignalModel.bulkWrite(ops.slice(i, i + 200), { ordered: false });
  return ops.length;
}

// One computation at a time. A stale copy is served at once and read again
// behind the page; only the very first read waits.
let running: Promise<MacroLive | null> | null = null;
export function refreshMacroLive(): Promise<MacroLive | null> {
  running ??= computeMacroLive()
    .then(async (r) => {
      if (r) {
        await saveFeedSnapshot(KEY, r, "ok", `${r.names.length} shares to ${r.asOf}`).catch(() => {});
        await storeSignals(r).catch(() => 0);
      }
      return r;
    })
    .finally(() => {
      running = null;
    });
  return running;
}

export async function getMacroLive(): Promise<MacroLive | null> {
  const snap = await getFeedSnapshot<MacroLive>(KEY).catch(() => ({ data: null, updatedAt: null }) as any);
  const age = snap.updatedAt ? Date.now() - new Date(snap.updatedAt).getTime() : Infinity;
  if (snap.data && age < TTL_MS) return snap.data;
  if (snap.data) {
    refreshMacroLive().catch(() => null);
    return snap.data;
  }
  return refreshMacroLive().catch(() => null);
}
