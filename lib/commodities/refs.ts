// Reference international prices for common PMEX commodities, via Yahoo futures.
// PMEX contracts settle in PKR, so the reference is informational: we show the
// international spot (USD) and a PKR-per-unit conversion to sanity-check marks.

import { fetchYahooDaily, fetchUsdPkrSpot } from "@/lib/timeseries/yahoo";

// `quote` says what the Yahoo number means, which decides how PKR is derived:
//   usd-per-base  -> price is USD for 1 unit (gold, EUR).  PKR = price x USD/PKR
//   base-per-usd  -> price is foreign units for 1 USD (JPY). PKR = USD/PKR / price
// Getting this wrong on USD/JPY would print "PKR 41,700 per yen", so the two
// cases are kept explicit rather than inferred from the symbol name.
export type RefKind = "commodity" | "currency";
export type RefQuote = "usd-per-base" | "base-per-usd";

export const COMMODITY_REFS: Record<
  string,
  { label: string; yahoo: string; unit: string; kind: RefKind; quote: RefQuote }
> = {
  GOLD: { label: "Gold", yahoo: "GC=F", unit: "USD/oz", kind: "commodity", quote: "usd-per-base" },
  SILVER: { label: "Silver", yahoo: "SI=F", unit: "USD/oz", kind: "commodity", quote: "usd-per-base" },
  CRUDE: { label: "Crude oil (WTI)", yahoo: "CL=F", unit: "USD/bbl", kind: "commodity", quote: "usd-per-base" },
  BRENT: { label: "Brent crude", yahoo: "BZ=F", unit: "USD/bbl", kind: "commodity", quote: "usd-per-base" },
  COPPER: { label: "Copper", yahoo: "HG=F", unit: "USD/lb", kind: "commodity", quote: "usd-per-base" },
  PLATINUM: { label: "Platinum", yahoo: "PL=F", unit: "USD/oz", kind: "commodity", quote: "usd-per-base" },
  NATURALGAS: { label: "Natural gas", yahoo: "NG=F", unit: "USD/MMBtu", kind: "commodity", quote: "usd-per-base" },
  // PMEX currency futures. The pair name is the contract; PKR below is what one
  // unit of the FIRST-named currency is worth in rupees.
  EURUSD: { label: "Euro / US dollar", yahoo: "EURUSD=X", unit: "USD per EUR", kind: "currency", quote: "usd-per-base" },
  GBPUSD: { label: "Pound / US dollar", yahoo: "GBPUSD=X", unit: "USD per GBP", kind: "currency", quote: "usd-per-base" },
  AUDUSD: { label: "Aussie / US dollar", yahoo: "AUDUSD=X", unit: "USD per AUD", kind: "currency", quote: "usd-per-base" },
  NZDUSD: { label: "Kiwi / US dollar", yahoo: "NZDUSD=X", unit: "USD per NZD", kind: "currency", quote: "usd-per-base" },
  USDJPY: { label: "US dollar / yen", yahoo: "USDJPY=X", unit: "JPY per USD", kind: "currency", quote: "base-per-usd" },
  USDCHF: { label: "US dollar / franc", yahoo: "USDCHF=X", unit: "CHF per USD", kind: "currency", quote: "base-per-usd" },
  USDCAD: { label: "US dollar / Canadian dollar", yahoo: "USDCAD=X", unit: "CAD per USD", kind: "currency", quote: "base-per-usd" },
};

export type CommodityRef = {
  symbol: string;
  label: string;
  usd: number | null; // the raw quote as Yahoo publishes it
  usdpkr: number | null;
  pkr: number | null; // rupees per one unit of the base (null when not derivable)
  unit: string;
  kind: RefKind;
};

export async function getCommodityRef(symbol: string): Promise<CommodityRef | null> {
  const meta = COMMODITY_REFS[symbol.toUpperCase()];
  if (!meta) return null;
  const [series, usdpkr] = await Promise.all([
    fetchYahooDaily(meta.yahoo, "3mo"),
    fetchUsdPkrSpot(),
  ]);
  const usd = series.length ? series[series.length - 1].close : null;
  let pkr: number | null = null;
  if (usd != null && usdpkr != null && usd > 0) {
    pkr = meta.quote === "usd-per-base" ? usd * usdpkr : usdpkr / usd;
  }
  return { symbol: symbol.toUpperCase(), label: meta.label, usd, usdpkr, pkr, unit: meta.unit, kind: meta.kind };
}
