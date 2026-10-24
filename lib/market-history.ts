import "server-only";
import { connectDb } from "@/lib/db";
import { FeedSnapshotModel, ShareEventModel } from "@/lib/models";
import { getFeedSnapshot, getSbpRateSteps, saveFeedSnapshot } from "@/lib/data";
import { fetchIndexConstituents } from "@/lib/timeseries/dps-indices";
import type { RateStep } from "@/lib/timeseries/sbp-rate";
import { afterTurns, cycleStats, indexMonthly, monthEnds, monthPatterns, rebuildMonthly, splice, turnsFromSteps, type MonthRet } from "@/lib/calculations/market-history";

// The KSE-100's monthly history and the studies on it (the Model page, the
// evening brief's month line). The exchange's own series where the server
// keeps it; before that the index rebuilt from its current members
// (lib/calculations/market-history). Kept a week. The State Bank's
// policy-rate steps back to 1991 are kept in the database
// (`rates:policy-history`), extended by the app's own rate feed.

const HISTORY_KEY = "market:kse100-monthly:v1";
const HISTORY_TTL_MS = 7 * 86400000;
const POLICY_KEY = "rates:policy-history";
const CONSTITUENTS_KEY = "index:constituents:KSE100";

export type MarketHistory = { series: MonthRet[]; fit: { months: number; corr: number | null; meanAbsDiff: number | null }; members: number; constituentsAsOf: string | null; builtAt: string };

// Every policy-rate step: the kept history, then the app's own steps after it.
export async function getPolicyHistory(): Promise<RateStep[]> {
  const kept = await getFeedSnapshot<{ steps: RateStep[] }>(POLICY_KEY).catch(() => null);
  const hist = (kept?.data?.steps ?? []).filter((s) => s.from && Number.isFinite(s.rate));
  const app = (await getSbpRateSteps().catch(() => null))?.steps ?? [];
  const last = hist.length ? hist.map((s) => s.from).sort().pop()! : "";
  const merged = [...hist, ...app.filter((s) => s.from > last)].sort((a, b) => a.from.localeCompare(b.from));
  return merged.filter((s, i) => i === 0 || s.rate !== merged[i - 1].rate);
}

async function constituents(): Promise<Array<{ symbol: string; units: number }>> {
  const live = await fetchIndexConstituents("KSE100").catch(() => []);
  if (live.length >= 50) {
    const byFloat = live.every((c) => c.freeFloat > 0);
    const rows = live.map((c) => ({ symbol: c.symbol, units: byFloat ? c.freeFloat : c.weightPct / c.current }));
    await saveFeedSnapshot(CONSTITUENTS_KEY, { asOf: new Date().toISOString().slice(0, 10), rows }, "ok", `${rows.length} members`).catch(() => {});
    return rows;
  }
  const kept = await getFeedSnapshot<{ asOf: string; rows: Array<{ symbol: string; units: number }> }>(CONSTITUENTS_KEY).catch(() => null);
  return kept?.data?.rows ?? [];
}

async function buildHistory(): Promise<MarketHistory> {
  await connectDb();
  const thisMonth = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 7);
  const idx: any = await FeedSnapshotModel.findOne({ key: "eod:bars:KSE100" }, { "data.bars": 1 }).lean();
  const real = indexMonthly(monthEnds(idx?.data?.bars ?? []));
  for (const m of [...real.keys()]) if (m >= thisMonth) real.delete(m);

  const cons = await constituents();
  const kept = await getFeedSnapshot<{ asOf: string }>(CONSTITUENTS_KEY).catch(() => null);
  const events = (await ShareEventModel.find({ symbol: { $in: cons.map((c) => c.symbol) }, kind: "cash" }, { symbol: 1, date: 1, yieldPct: 1 }).lean()) as any[];
  const divOf = new Map<string, Map<string, number>>();
  for (const e of events) {
    const m = divOf.get(e.symbol) ?? new Map<string, number>();
    const k = String(e.date).slice(0, 7);
    m.set(k, (m.get(k) ?? 0) + (Number(e.yieldPct) || 0));
    divOf.set(e.symbol, m);
  }
  const members: Array<{ units: number; ends: Map<string, number>; divPct: Map<string, number> }> = [];
  const months = new Set<string>();
  for (const c of cons) {
    const doc: any = await FeedSnapshotModel.findOne({ key: `eod:bars:${c.symbol}` }, { "data.bars": 1 }).lean();
    const ends = monthEnds(doc?.data?.bars ?? []);
    if (ends.size < 12) continue;
    for (const m of ends.keys()) if (m < thisMonth) months.add(m);
    members.push({ units: c.units, ends, divPct: divOf.get(c.symbol) ?? new Map() });
  }
  const rebuilt = rebuildMonthly(members, [...months].sort());
  const { series, fit } = splice(real, rebuilt);
  return { series, fit, members: members.length, constituentsAsOf: kept?.data?.asOf ?? null, builtAt: new Date().toISOString() };
}

export async function getMarketHistory(rebuild = false): Promise<MarketHistory> {
  const kept = await getFeedSnapshot<MarketHistory>(HISTORY_KEY).catch(() => null);
  const age = kept?.updatedAt ? Date.now() - new Date(kept.updatedAt).getTime() : Infinity;
  if (!rebuild && kept?.data?.series?.length && age < HISTORY_TTL_MS) return kept.data;
  const h = await buildHistory();
  if (h.series.length) await saveFeedSnapshot(HISTORY_KEY, h, "ok", `${h.series.length} months, fit r ${h.fit.corr?.toFixed(3) ?? "-"}`).catch(() => {});
  return h;
}

export type MarketStudies = {
  history: Omit<MarketHistory, "series"> & { from: string | null; to: string | null; rebuiltTo: string | null };
  patterns: ReturnType<typeof monthPatterns>;
  cycles: ReturnType<typeof cycleStats>;
  after: ReturnType<typeof afterTurns>;
  now: { state: "easing" | "tightening" | null; since: string | null; rate: number | null };
};

export async function getMarketStudies(rebuild = false): Promise<MarketStudies> {
  const [h, steps] = await Promise.all([getMarketHistory(rebuild), getPolicyHistory()]);
  const turns = turnsFromSteps(steps);
  const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
  const lastTurn = [...turns].reverse().find((t) => t.date <= today) ?? null;
  const rebuiltRows = h.series.filter((r) => r.source === "rebuilt");
  return {
    history: { fit: h.fit, members: h.members, constituentsAsOf: h.constituentsAsOf, builtAt: h.builtAt, from: h.series[0]?.month ?? null, to: h.series[h.series.length - 1]?.month ?? null, rebuiltTo: rebuiltRows.length ? rebuiltRows[rebuiltRows.length - 1].month : null },
    patterns: monthPatterns(h.series),
    cycles: cycleStats(h.series, turns),
    after: afterTurns(h.series, turns),
    now: { state: lastTurn ? (lastTurn.kind === "cut" ? "easing" : "tightening") : null, since: lastTurn?.date ?? null, rate: steps.length ? steps[steps.length - 1].rate : null },
  };
}
