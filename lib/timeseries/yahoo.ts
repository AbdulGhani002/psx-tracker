// Free daily time series from Yahoo Finance's public chart endpoint.
// Verified working server-side (no API key) for:
//   USDPKR=X  -> USD/PKR exchange rate (close in PKR)
//   ^GSPC     -> S&P 500 index (close in USD)
// Response shape:
//   { chart: { result: [ { timestamp: number[],
//                          indicators: { quote: [ { close: (number|null)[] } ] } } ] } }

import type { EodPoint } from "./psx-eod";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

export type YahooRange = "3mo" | "6mo" | "1y" | "2y" | "5y" | "max";

export async function fetchYahooDaily(
  symbol: string,
  range: YahooRange = "1y"
): Promise<EodPoint[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?range=${range}&interval=1d`;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const body = await res.json();
    const result = body?.chart?.result?.[0];
    if (!result) return [];
    const ts: number[] = result.timestamp ?? [];
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
    if (ts.length === 0 || closes.length === 0) return [];

    const out: EodPoint[] = [];
    let lastClose: number | null = null;
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      const close: number | null = c == null ? lastClose : c;
      if (close == null) continue;
      lastClose = close;
      const iso = new Date(ts[i] * 1000).toISOString().slice(0, 10);
      out.push({ date: iso, close });
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  } catch {
    return [];
  }
}

// Spot USD->PKR fallback (free CDN, no key). Used if Yahoo is unreachable.
export async function fetchUsdPkrSpot(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json",
      { headers: { "user-agent": UA }, cache: "no-store" }
    );
    if (!res.ok) return null;
    const body = await res.json();
    const pkr = body?.usd?.pkr;
    return typeof pkr === "number" ? pkr : null;
  } catch {
    return null;
  }
}
