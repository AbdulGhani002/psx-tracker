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
