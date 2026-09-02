// Run the user's OWN ladder against the record, not a textbook one.
//
// The rungs on the Plan page are absolute index levels, because that is how a
// person writes a plan: "buy at 168,000". A level cannot be tested across years
// — 168,000 did not exist in 2022 — so each rung is first restated as the FALL
// FROM A HIGH that it represents, and it is that shape which gets tested.
//
// The reference high is the index's own peak at the moment the ladder was
// armed. That is the number the levels were chosen against, so it is the only
// honest thing to measure them from. Where no arming date is recorded, the peak
// of the last year is used and the result says so.
//
// The index series is cached for half a day. The simulation itself is pure
// arithmetic over about 1,200 bars and takes milliseconds, so only the fetch is
// worth storing.

import { fetchEodSeries, type EodPoint } from "@/lib/timeseries/psx-eod";
import { getFeedSnapshot, saveFeedSnapshot } from "@/lib/data";
import {
  runBacktest,
  DEFAULT_CONFIG,
  type Bar,
  type BacktestConfig,
  type BacktestResult,
  type BacktestRung,
  type StrategyKey,
} from "@/lib/calculations/backtest";

export const EOD_CACHE_KEY = "backtest:kse100";
const FRESH_MS = 12 * 60 * 60 * 1000;

export type RuleCheckWindow = {
  label: string;
  from: string;
  to: string;
  years: number;
  indexReturnPct: number;
  rows: Array<{ key: StrategyKey; label: string; xirrPct: number | null; maxDrawdownPct: number }>;
};

export type RuleCheck = {
  ok: boolean;
  reason: string;
  referenceHigh: number;
  referenceNote: string;
  usingSample: boolean; // true when the user has no rungs and a sample was tested
  rungs: BacktestRung[];
  full: BacktestResult;
  windows: RuleCheckWindow[];
  at: string;
};

async function getSeries(force = false): Promise<Bar[]> {
  const cached = await getFeedSnapshot<EodPoint[]>(EOD_CACHE_KEY);
  const fresh =
    Array.isArray(cached.data) &&
    cached.data.length > 0 &&
    cached.updatedAt &&
    Date.now() - new Date(cached.updatedAt).getTime() < FRESH_MS;
  if (!force && fresh) return cached.data as Bar[];
  try {
    const live = await fetchEodSeries("KSE100");
    if (live.length > 0) {
      await saveFeedSnapshot(EOD_CACHE_KEY, live, "ok", live.length + " sessions").catch(() => {});
      return live;
    }
  } catch {
    /* fall through to whatever is stored */
  }
  return (cached.data as Bar[]) ?? [];
}

// The peak the ladder's levels were written against.
function referenceHigh(series: Bar[], armedAt: string): { high: number; note: string } {
  if (series.length === 0) return { high: 0, note: "" };
  const cutoff = armedAt && /^\d{4}-\d{2}-\d{2}/.test(armedAt) ? armedAt.slice(0, 10) : "";
  if (cutoff) {
    const upto = series.filter((b) => b.date <= cutoff);
    if (upto.length > 0) {
      const high = Math.max(...upto.map((b) => b.close));
      return { high, note: "measured against the index high of " + Math.round(high).toLocaleString("en-PK") + " on the day you armed the ladder" };
    }
  }
  const yearAgo = new Date();
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const key = yearAgo.toISOString().slice(0, 10);
  const recent = series.filter((b) => b.date >= key);
  const high = Math.max(...(recent.length > 0 ? recent : series).map((b) => b.close));
  return {
    high,
    note:
      "no arming date recorded, so the levels are measured against the last year's high of " +
      Math.round(high).toLocaleString("en-PK"),
  };
}

// An index level becomes the fall it implies. A rung ABOVE the reference is a
// level the market has already passed, which cannot be expressed as a fall, so
// it is dropped and the caller is told.
export function rungsToFalls(
  rungs: Array<{ level: number; pct: number; label?: string }>,
  high: number
): { falls: BacktestRung[]; dropped: number } {
  if (!(high > 0)) return { falls: [], dropped: 0 };
  let dropped = 0;
  const falls: BacktestRung[] = [];
  for (const r of rungs ?? []) {
    const level = Number(r.level);
    const pct = Number(r.pct);
    if (!(level > 0) || !(pct > 0)) continue;
    const fallPct = ((high - level) / high) * 100;
    if (fallPct <= 0) {
      dropped++;
      continue;
    }
    falls.push({ fallPct, pct, label: r.label || Math.round(level).toLocaleString("en-PK") });
  }
  return { falls: falls.sort((a, b) => a.fallPct - b.fallPct), dropped };
}

export type RuleCheckInput = {
  rungs: Array<{ level: number; pct: number; label?: string }>;
  reservePct: number;
  armedAt: string;
  monthlyContribution: number;
  startCash: number;
  cashYieldPct: number;
};

export async function runRuleCheck(input: RuleCheckInput, force = false): Promise<RuleCheck> {
  const at = new Date().toISOString();
  const series = await getSeries(force);

  const empty = (reason: string): RuleCheck => ({
    ok: false,
    reason,
    referenceHigh: 0,
    referenceNote: "",
    usingSample: false,
    rungs: [],
    full: runBacktest([], {}),
    windows: [],
    at,
  });

  if (series.length < 400) return empty("Not enough index history has been collected yet to test anything.");

  const { high, note } = referenceHigh(series, input.armedAt);
  const converted = rungsToFalls(input.rungs, high);
  const usingSample = converted.falls.length === 0;
  const rungs = usingSample ? DEFAULT_CONFIG.rungs : converted.falls;

  const config: Partial<BacktestConfig> = {
    startCash: input.startCash > 0 ? input.startCash : DEFAULT_CONFIG.startCash,
    monthlyContribution: input.monthlyContribution >= 0 ? input.monthlyContribution : DEFAULT_CONFIG.monthlyContribution,
    cashYieldPct: input.cashYieldPct > 0 ? input.cashYieldPct : DEFAULT_CONFIG.cashYieldPct,
    reservePct: input.reservePct >= 0 ? input.reservePct : DEFAULT_CONFIG.reservePct,
    rungs,
  };

  const full = runBacktest(series, config);
  if (full.strategies.length === 0) return empty(full.notes[0] ?? "The run produced nothing.");

  const last = series[series.length - 1].date;
  const yearsAgo = (n: number) => {
    const d = new Date(last + "T00:00:00Z");
    d.setUTCFullYear(d.getUTCFullYear() - n);
    return d.toISOString().slice(0, 10);
  };

  // Windows chosen so a rally and a bear are both visible. A single number over
  // a period that only went up is an advertisement, not a test.
  const wanted: Array<[string, string, string]> = [
    ["Everything on record", series[0].date, last],
    ["The 2021-23 fall", "2021-01-01", "2023-06-30"],
    ["The rally since", "2023-07-01", last],
    ["Last three years", yearsAgo(3), last],
    ["Last twelve months", yearsAgo(1), last],
  ];

  const windows: RuleCheckWindow[] = [];
  for (const [label, from, to] of wanted) {
    const slice = series.filter((b) => b.date >= from && b.date <= to);
    if (slice.length < 260) continue; // a year of sessions is the floor
    const w = runBacktest(slice, config);
    if (w.strategies.length === 0) continue;
    windows.push({
      label,
      from: w.from,
      to: w.to,
      years: w.years,
      indexReturnPct: w.indexReturnPct,
      rows: w.strategies.map((s) => ({
        key: s.key,
        label: s.label,
        xirrPct: s.xirrPct,
        maxDrawdownPct: s.maxDrawdownPct,
      })),
    });
  }

  let referenceNote = note;
  if (converted.dropped > 0) {
    referenceNote +=
      ". " + converted.dropped + " rung" + (converted.dropped === 1 ? " sits" : "s sit") +
      " above that high, so " + (converted.dropped === 1 ? "it was" : "they were") +
      " left out — a rung the market has already passed cannot be written as a fall";
  }

  return { ok: true, reason: "", referenceHigh: high, referenceNote, usingSample, rungs, full, windows, at };
}
