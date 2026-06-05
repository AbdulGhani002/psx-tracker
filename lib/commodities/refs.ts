// Reference international prices for common PMEX commodities, via Yahoo futures.
// PMEX contracts settle in PKR, so the reference is informational: we show the
// international spot (USD) and a PKR-per-unit conversion to sanity-check marks.

import { fetchYahooDaily, fetchUsdPkrSpot } from "@/lib/timeseries/yahoo";

export const COMMODITY_REFS: Record<string, { label: string; yahoo: string; unit: string }> = {
  GOLD: { label: "Gold", yahoo: "GC=F", unit: "USD/oz" },
  SILVER: { label: "Silver", yahoo: "SI=F", unit: "USD/oz" },
  CRUDE: { label: "Crude oil (WTI)", yahoo: "CL=F", unit: "USD/bbl" },
  BRENT: { label: "Brent crude", yahoo: "BZ=F", unit: "USD/bbl" },
  COPPER: { label: "Copper", yahoo: "HG=F", unit: "USD/lb" },
  PLATINUM: { label: "Platinum", yahoo: "PL=F", unit: "USD/oz" },
  NATURALGAS: { label: "Natural gas", yahoo: "NG=F", unit: "USD/MMBtu" },
};

export type CommodityRef = {
  symbol: string;
  label: string;
  usd: number | null;
  usdpkr: number | null;
  pkr: number | null; // usd * usdpkr (per unit)
  unit: string;
};

export async function getCommodityRef(symbol: string): Promise<CommodityRef | null> {
  const meta = COMMODITY_REFS[symbol.toUpperCase()];
  if (!meta) return null;
  const [series, usdpkr] = await Promise.all([
    fetchYahooDaily(meta.yahoo, "3mo"),
    fetchUsdPkrSpot(),
  ]);
  const usd = series.length ? series[series.length - 1].close : null;
  const pkr = usd != null && usdpkr != null ? usd * usdpkr : null;
  return { symbol: symbol.toUpperCase(), label: meta.label, usd, usdpkr, pkr, unit: meta.unit };
}
