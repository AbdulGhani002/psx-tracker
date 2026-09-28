// Fill in the part of the regime scorecard a machine can read.
//
// Eight of the nine signals come from data the app already fetches for other
// pages: the KSE-100 end-of-day series, Yahoo for Brent and the rupee, the SBP
// rate table, the CPI feed, the analytics service's NCCPL flows, and the PSX
// market-watch board. Nothing new is paid for.
//
// Politics is the one signal that stays manual, and it stays manual on purpose.
// There is no feed for "is the IMF programme on track", and a sentiment score
// scraped off headlines would dress a guess up as a reading. It is your call,
// and the scorecard says so on the page.
//
// Every fetch degrades on its own: a signal that cannot be read is marked
// unknown and simply drops out of the average, rather than scoring zero and
// quietly dragging the total toward neutral.

import { eodSeriesCached } from "@/lib/timeseries/eod-cache";
import { fetchYahooDaily } from "@/lib/timeseries/yahoo";
import { getSbpRateSteps, getInflationLive, getFeedSnapshot, saveFeedSnapshot } from "@/lib/data";
import { getFlows } from "@/lib/analytics";
import { fetchMarketWatch, isInIndex } from "@/lib/prices/marketwatch";
import {
  scoreTrend200,
  scoreCross,
  scoreOil,
  scorePkr,
  scorePolicy,
  scoreCpi,
  scoreForeign,
  scoreBreadth,
  SIGNAL_HINTS,
  type RegimeSignal,
} from "@/lib/calculations/regime";

export const REGIME_AUTO_KEY = "regime:auto";
export const BREADTH_HISTORY_KEY = "regime:breadth";
const FRESH_MS = 6 * 60 * 60 * 1000;

// How many past sessions of breadth to average over. One session is a coin
// toss; two weeks is a character.
const BREADTH_WINDOW = 10;
const BREADTH_MIN = 3; // below this, say we are still collecting rather than score it

export type BreadthPoint = { date: string; advancePct: number; moved: number; medianChangePct: number };

export type AutoSignals = {
  signals: RegimeSignal[];
  indexLevel: number;
  indexAsOf: string;
  ma50: number;
  ma200: number;
  at: string;
};

const sma = (vals: number[], n: number): number => {
  if (vals.length < n) return 0;
  const slice = vals.slice(-n);
  return slice.reduce((s, v) => s + v, 0) / n;
};

const pctChange = (series: Array<{ date: string; close: number }>, days: number): number | null => {
  if (series.length < 2) return null;
  const last = series[series.length - 1];
  const target = new Date(last.date);
  target.setDate(target.getDate() - days);
  const key = target.toISOString().slice(0, 10);
  // First point on or after the cutoff — closest thing to "N days ago" on a
  // calendar that skips weekends and holidays.
  const then = series.find((p) => p.date >= key) ?? series[0];
  if (!(then.close > 0)) return null;
  return ((last.close - then.close) / then.close) * 100;
};

const unknown = (key: string, label: string, why: string): RegimeSignal => ({
  key,
  label,
  source: "auto",
  score: 0,
  reading: why,
  known: false,
  hint: SIGNAL_HINTS[key] ?? "",
});

export async function computeAutoSignals(): Promise<AutoSignals> {
  const at = new Date().toISOString();
  const signals: RegimeSignal[] = [];
  let indexLevel = 0;
  let indexAsOf = "";
  let ma50 = 0;
  let ma200 = 0;

  // --- the index against its own averages -----------------------------------
  try {
    const kse = await eodSeriesCached("KSE100");
    const closes = kse.map((p) => p.close).filter((c) => c > 0);
    if (closes.length >= 200) {
      indexLevel = closes[closes.length - 1];
      indexAsOf = kse[kse.length - 1].date;
      ma200 = sma(closes, 200);
      ma50 = sma(closes, 50);
      // Is the 200-day average itself rising? Compare it with where it stood a
      // month ago, which is what "rising" means on a slow average.
      const ma200Prev = sma(closes.slice(0, closes.length - 21), 200);
      const slopePct = ma200Prev > 0 ? ((ma200 - ma200Prev) / ma200Prev) * 100 : 0;

      const t = scoreTrend200(indexLevel, ma200, slopePct);
      signals.push({ key: "trend200", label: "Index vs 200-day average", source: "auto", ...t, known: true, hint: SIGNAL_HINTS.trend200 });

      const c = scoreCross(ma50, ma200);
      signals.push({ key: "cross", label: "50-day vs 200-day", source: "auto", ...c, known: true, hint: SIGNAL_HINTS.cross });
    } else {
      signals.push(unknown("trend200", "Index vs 200-day average", "not enough index history"));
      signals.push(unknown("cross", "50-day vs 200-day", "not enough index history"));
    }
  } catch {
    signals.push(unknown("trend200", "Index vs 200-day average", "index feed unavailable"));
    signals.push(unknown("cross", "50-day vs 200-day", "index feed unavailable"));
  }

  // --- oil: Pakistan imports it, so up is a headwind ------------------------
  try {
    const brent = await fetchYahooDaily("BZ=F", "6mo");
    const ch = pctChange(brent as any, 90);
    if (ch != null) {
      const s = scoreOil(ch);
      signals.push({ key: "oil", label: "Oil (Brent)", source: "auto", ...s, known: true, hint: SIGNAL_HINTS.oil });
    } else signals.push(unknown("oil", "Oil (Brent)", "no oil history"));
  } catch {
    signals.push(unknown("oil", "Oil (Brent)", "oil feed unavailable"));
  }

  // --- the rupee -------------------------------------------------------------
  try {
    const fx = await fetchYahooDaily("USDPKR=X", "6mo");
    const ch = pctChange(fx as any, 90);
    if (ch != null) {
      const s = scorePkr(ch);
      signals.push({ key: "pkr", label: "Rupee vs dollar", source: "auto", ...s, known: true, hint: SIGNAL_HINTS.pkr });
    } else signals.push(unknown("pkr", "Rupee vs dollar", "no FX history"));
  } catch {
    signals.push(unknown("pkr", "Rupee vs dollar", "FX feed unavailable"));
  }

  // --- policy rate direction --------------------------------------------------
  // Steps come back as { from, rate }, newest last once sorted.
  try {
    const { steps } = await getSbpRateSteps();
    const sorted = [...(steps ?? [])]
      .filter((s: any) => s && s.from && Number.isFinite(Number(s.rate)))
      .sort((a: any, b: any) => String(a.from).localeCompare(String(b.from)));
    if (sorted.length > 0) {
      const latest: any = sorted[sorted.length - 1];
      const cut = new Date();
      cut.setMonth(cut.getMonth() - 6);
      const key = cut.toISOString().slice(0, 10);
      // The rate in force six months ago: the last step that began on or before
      // the cutoff, not the first step after it.
      const before: any = [...sorted].reverse().find((s: any) => String(s.from) <= key) ?? sorted[0];
      const bps = Math.round((Number(latest.rate) - Number(before.rate)) * 100);
      const s = scorePolicy(bps);
      signals.push({
        key: "policy",
        label: "Policy rate direction",
        source: "auto",
        score: s.score,
        reading: `${Number(latest.rate).toFixed(2)}% now, ${s.reading}`,
        known: true,
        hint: SIGNAL_HINTS.policy,
      });
    } else signals.push(unknown("policy", "Policy rate direction", "no rate history"));
  } catch {
    signals.push(unknown("policy", "Policy rate direction", "rate table unavailable"));
  }

  // --- inflation direction ----------------------------------------------------
  // The CPI feed stores a monthly INDEX series, not a series of rates, so the
  // year-on-year rate has to be derived at both ends before they can be compared.
  try {
    const inf = await getInflationLive();
    const hist = (inf?.history ?? []).filter((p) => p && p.index > 0);
    const yoyAt = (i: number): number | null => {
      if (i < 12) return null;
      const base = hist[i - 12]?.index;
      return base > 0 ? ((hist[i].index - base) / base) * 100 : null;
    };
    const nowYoY = inf?.yoyPct ?? yoyAt(hist.length - 1);
    const thenYoY = yoyAt(hist.length - 7); // six months earlier
    if (nowYoY != null && thenYoY != null) {
      const s = scoreCpi(nowYoY - thenYoY);
      signals.push({
        key: "cpi",
        label: "Inflation direction",
        source: "auto",
        score: s.score,
        reading: `${nowYoY.toFixed(1)}% now, ${s.reading}`,
        known: true,
        hint: SIGNAL_HINTS.cpi,
      });
    } else if (nowYoY != null) {
      // A level with no six-month comparison is worth showing, but it cannot be
      // scored as a direction, so it stays out of the total.
      signals.push(unknown("cpi", "Inflation direction", `${nowYoY.toFixed(1)}% now, no six-month history to compare`));
    } else {
      signals.push(unknown("cpi", "Inflation direction", "no CPI history stored"));
    }
  } catch {
    signals.push(unknown("cpi", "Inflation direction", "CPI feed unavailable"));
  }

  // --- foreign flows ----------------------------------------------------------
  // NCCPL's FIPI, already parsed by the analytics service for the flows data.
  // It returns null when that service is down, which is a missing reading and
  // not a flat one.
  try {
    const flows = await getFlows(90);
    if (flows && Number.isFinite(flows.fipi_20d)) {
      const s = scoreForeign(flows.fipi_20d, flows.fipi_5d);
      const streak =
        flows.streak > 1 ? `, ${flows.streak} sessions of net ${flows.streak_side}` : "";
      signals.push({
        key: "foreign",
        label: "Foreign flows",
        source: "auto",
        score: s.score,
        reading: s.reading + streak,
        known: true,
        hint: SIGNAL_HINTS.foreign,
      });
    } else {
      signals.push(unknown("foreign", "Foreign flows", "flows service did not answer"));
    }
  } catch {
    signals.push(unknown("foreign", "Foreign flows", "flows service unavailable"));
  }

  // --- breadth ----------------------------------------------------------------
  try {
    const breadth = await updateBreadthHistory();
    if (breadth.points.length >= BREADTH_MIN) {
      const avg =
        breadth.points.reduce((s, p) => s + p.advancePct, 0) / breadth.points.length;
      const s = scoreBreadth(avg, breadth.points.length);
      signals.push({
        key: "breadth",
        label: "Market breadth",
        source: "auto",
        score: s.score,
        reading: s.reading,
        known: true,
        hint: SIGNAL_HINTS.breadth,
      });
    } else {
      signals.push(
        unknown(
          "breadth",
          "Market breadth",
          `still collecting — ${breadth.points.length} of ${BREADTH_MIN} sessions stored`
        )
      );
    }
  } catch {
    signals.push(unknown("breadth", "Market breadth", "market-watch board unavailable"));
  }

  return { signals, indexLevel, indexAsOf, ma50, ma200, at };
}

// Breadth needs a history and PSX publishes only today. So today is appended to
// a stored series, one point per trading day, and the score reads the average.
// Re-running on the same day overwrites that day rather than stacking it.
export async function updateBreadthHistory(): Promise<{ points: BreadthPoint[]; today: BreadthPoint | null }> {
  const stored = await getFeedSnapshot<BreadthPoint[]>(BREADTH_HISTORY_KEY);
  const points: BreadthPoint[] = Array.isArray(stored.data) ? [...stored.data] : [];

  const mw = await fetchMarketWatch();
  if (!mw || mw.size === 0) return { points: points.slice(-BREADTH_WINDOW), today: null };

  const members = [...mw.values()].filter((r) => isInIndex(r, "KSE100"));
  // A name that did not trade has no opinion. Counting it as unchanged would
  // drag every reading toward the middle on a quiet day.
  const moved = members.filter((r) => r.changePct != null && Math.abs(r.changePct) > 0.0001);
  if (moved.length < 20) return { points: points.slice(-BREADTH_WINDOW), today: null };

  const advances = moved.filter((r) => (r.changePct as number) > 0).length;
  const changes = moved.map((r) => r.changePct as number).sort((a, b) => a - b);
  const median = changes[Math.floor(changes.length / 2)];

  const today: BreadthPoint = {
    date: new Date().toISOString().slice(0, 10),
    advancePct: (advances / moved.length) * 100,
    moved: moved.length,
    medianChangePct: median,
  };

  const kept = points.filter((p) => p.date !== today.date);
  kept.push(today);
  kept.sort((a, b) => a.date.localeCompare(b.date));
  const trimmed = kept.slice(-BREADTH_WINDOW);
  await saveFeedSnapshot(BREADTH_HISTORY_KEY, trimmed, "ok", `${trimmed.length} sessions`).catch(() => {});
  return { points: trimmed, today };
}

// Cached wrapper: the auto signals need several external fetches, and the
// scorecard is a monthly-cadence tool, so a six-hour cache is generous. A failed
// recompute falls back to the last good copy rather than blanking the page.
export async function getAutoSignalsCached(force = false): Promise<{ data: AutoSignals | null; stale: boolean }> {
  const cached = await getFeedSnapshot<AutoSignals>(REGIME_AUTO_KEY);
  const fresh =
    cached.data && cached.updatedAt && Date.now() - new Date(cached.updatedAt).getTime() < FRESH_MS;
  if (!force && fresh) return { data: cached.data!, stale: false };
  try {
    const data = await computeAutoSignals();
    if (data.signals.some((s) => s.known)) {
      await saveFeedSnapshot(REGIME_AUTO_KEY, data, "ok", `${data.signals.filter((s) => s.known).length} signals`).catch(() => {});
      return { data, stale: false };
    }
  } catch {
    /* fall through */
  }
  if (cached.data) return { data: cached.data, stale: true };
  return { data: null, stale: false };
}
