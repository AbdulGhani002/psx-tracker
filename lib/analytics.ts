import "server-only";

// Client for the psx-v5 analytics-service (AI ratings, screener, heatmap,
// rotation, comparison). It runs on the same VPS host, bound to localhost, so
// the tracker reaches it server-side at 127.0.0.1:8100 and the browser never
// sees it. Everything degrades gracefully to null when it's unreachable (e.g.
// local dev), so pages render a "warming up" state instead of crashing.
const ANALYTICS_URL = process.env.ANALYTICS_URL || "http://127.0.0.1:8100";

export async function analyticsGet<T = any>(path: string, revalidate = 300): Promise<T | null> {
  try {
    const res = await fetch(`${ANALYTICS_URL}${path}`, {
      next: { revalidate },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export type RatedStock = {
  symbol: string;
  name: string | null;
  sector: string | null;
  price: number | null;
  change_pct: number | null;
  pe: number | null;
  earnings_yield_pct: number | null;
  dividend_yield_pct: number | null;
  eps_cagr_pct: number | null;
  net_margin_pct: number | null;
  rsi14: number | null;
  macd_hist: number | null;
  above_sma50: boolean;
  above_sma200: boolean;
  vol_spike: number | null;
  volatility_pct: number | null;
  beta: number | null;
  market_cap_000: number | null;
  overall: number;
  stars: number;
  verdict: "strong" | "good" | "neutral" | "weak";
  score_technical: number;
  score_fundamental: number;
  score_risk: number;
  score_safety: number;
  needs_book_value?: boolean;
};

export const getRatings = (limit = 500) => analyticsGet<{ count: number; results: RatedStock[] }>(`/screen?sort_by=overall&limit=${limit}`);
export const getRating = (sym: string) => analyticsGet<any>(`/rating/${encodeURIComponent(sym.toUpperCase())}`);
export const getHeatmap = () => analyticsGet<{ sectors: any[] }>(`/heatmap`);
export const getRotation = () => analyticsGet<{ entering: any[]; leaving: any[]; all: any[] }>(`/sector-rotation`);
export const getCompare = (syms: string[]) => analyticsGet<{ stocks: RatedStock[] }>(`/compare?symbols=${syms.map((s) => s.toUpperCase()).join(",")}`);

// ---- Phase 3: backtest, optimizer, patterns, dividend calendar ----

export type Pattern = {
  pattern: string;
  direction: "bullish" | "bearish";
  confidence: number;
  note: string;
  triggered: boolean;
};
export type ScannedPattern = Pattern & { symbol: string };

export const getPatterns = (sym: string) =>
  analyticsGet<{ symbol: string; patterns: Pattern[] }>(`/patterns/${encodeURIComponent(sym.toUpperCase())}`);
export const getPatternScan = (params: { pattern?: string; direction?: string; limit?: number } = {}) => {
  const p = new URLSearchParams();
  if (params.pattern) p.set("pattern", params.pattern);
  if (params.direction) p.set("direction", params.direction);
  p.set("limit", String(params.limit ?? 120));
  return analyticsGet<{ count: number; results: ScannedPattern[] }>(`/patterns/scan?${p.toString()}`, 600);
};

export type Dividend = {
  symbol: string;
  pct_of_face: number | null;
  types: string[];
  cycle: string;
  ex_date: string;
  book_closure_end: string | null;
  announced: string | null;
  upcoming: boolean;
};
export const getDividendCalendar = () =>
  analyticsGet<{ upcoming: Dividend[]; recent: Dividend[]; today: string }>(`/calendar/dividends`, 900);

// ---- FIPI/LIPI investor flows (foreign vs local) ----

export type FlowCategory = {
  category: string;
  mtype: "Foreign" | "Local";
  net_usd_mn: number;
  buy_usd_mn: number;
  sell_usd_mn: number;
};
export type FlowPoint = { date: string; fipi: number; lipi: number };
export type FlowsData = {
  days: number;
  latest: string | null;
  fipi_today: number;
  lipi_today: number;
  fipi_5d: number;
  fipi_20d: number;
  cumulative_fipi: number;
  streak: number;
  streak_side: "buying" | "selling" | "flat";
  categories: FlowCategory[];
  series: FlowPoint[];
  cumulative: { date: string; value: number }[];
};
export const getFlows = (days = 90) => analyticsGet<FlowsData>(`/flows?days=${days}`, 600);

// ---- News (PK business feeds, lexicon sentiment) + earnings calendar ----

export type NewsArticle = {
  source: string;
  title: string;
  url: string;
  published_at: string | null;
  summary: string;
  ai_summary?: string | null;
  symbols: string[];
  sentiment: number;
};
export const getNews = (symbol?: string, limit = 60) =>
  analyticsGet<{ count: number; articles: NewsArticle[] }>(
    `/news?${symbol ? `symbol=${encodeURIComponent(symbol.toUpperCase())}&` : ""}limit=${limit}`,
    600
  );

export type EarningsRow = { symbol: string; date: string; purpose: string };
export const getEarningsCalendar = () =>
  analyticsGet<{ upcoming: EarningsRow[]; recent: EarningsRow[]; today: string }>(`/calendar/earnings`, 900);
