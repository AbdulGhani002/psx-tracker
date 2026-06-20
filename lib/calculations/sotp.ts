// Sum-of-the-parts / look-through valuation for holding companies.
//
// A holding company (e.g. Arif Habib Corp) is a wrapper around stakes in other
// listed companies plus unlisted assets, cash and debt. Its share price usually
// trades at a DISCOUNT to what it actually owns. This values the underlying
// pieces at LIVE prices and compares to the market price to surface that gap.
//
//   look-through NAV = Σ(stake shares × live price) + unlisted assets − net debt
//   NAV / share      = look-through NAV ÷ shares outstanding
//   discount         = (NAV/share − market price) / NAV/share
//
// Stakes (which companies, how many shares) come from the annual report and are
// entered once; everything else is live or derived.

export type SotpConstituentInput = {
  label: string;
  symbol: string;
  shares: number; // shares the holding company owns
};

// A private/unlisted holding (no PSX price): value comes from the annual report
// or your estimate, never a fabricated market price.
export type SotpUnlistedInput = {
  label: string;
  valuePkr: number;
  ownershipPct?: number;
  note?: string;
};

export type SotpInputs = {
  constituents: SotpConstituentInput[];
  prices: Record<string, number>; // live price per constituent symbol
  unlistedHoldings?: SotpUnlistedInput[]; // named private holdings (each carries its own value)
  unlistedValuePkr: number; // legacy single lump (added on top of the named list)
  netDebtPkr: number;
  sharesOutstanding: number; // of the holding company itself
  marketPrice: number; // holding company's own live price
  heldShares: number; // how many of the holding company YOU own
};

export type SotpUnlisted = {
  label: string;
  value: number;
  ownershipPct: number;
  note: string;
  pctOfAssets: number;
};

export type SotpConstituent = {
  label: string;
  symbol: string;
  shares: number;
  price: number;
  value: number; // shares × price
  pctOfAssets: number;
  priced: boolean; // false if no live price available
};

export type SotpResult = {
  constituents: SotpConstituent[];
  unlistedHoldings: SotpUnlisted[]; // named private holdings, sized vs gross assets
  listedValue: number;
  unlistedValue: number; // total of named unlisted + legacy lump
  netDebt: number;
  navTotal: number; // look-through net asset value
  sharesOutstanding: number;
  navPerShare: number;
  marketPrice: number;
  marketCap: number; // market price × shares outstanding
  discountPct: number | null; // (nav/share − price) / (nav/share); positive = trading below NAV
  yourMarketValue: number; // heldShares × marketPrice
  yourLookThroughValue: number; // heldShares × nav/share
  missingPrices: string[];
};

export function computeSotp(i: SotpInputs): SotpResult {
  const constituents: SotpConstituent[] = i.constituents.map((c) => {
    const price = i.prices[c.symbol?.toUpperCase()] ?? i.prices[c.symbol] ?? 0;
    const value = c.shares * price;
    return { label: c.label || c.symbol, symbol: c.symbol, shares: c.shares, price, value, pctOfAssets: 0, priced: price > 0 };
  });

  const listedValue = constituents.reduce((s, c) => s + c.value, 0);
  const namedUnlisted = (i.unlistedHoldings ?? []).filter((u) => u.label || u.valuePkr);
  const namedUnlistedTotal = namedUnlisted.reduce((s, u) => s + (u.valuePkr || 0), 0);
  const unlistedTotal = namedUnlistedTotal + i.unlistedValuePkr;
  const grossAssets = listedValue + unlistedTotal;
  const navTotal = grossAssets - i.netDebtPkr;
  for (const c of constituents) c.pctOfAssets = grossAssets > 0 ? (c.value / grossAssets) * 100 : 0;

  const unlistedHoldings: SotpUnlisted[] = namedUnlisted
    .map((u) => ({
      label: u.label || "Unlisted",
      value: u.valuePkr || 0,
      ownershipPct: u.ownershipPct ?? 0,
      note: u.note ?? "",
      pctOfAssets: grossAssets > 0 ? ((u.valuePkr || 0) / grossAssets) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);

  const navPerShare = i.sharesOutstanding > 0 ? navTotal / i.sharesOutstanding : 0;
  const discountPct = navPerShare > 0 ? ((navPerShare - i.marketPrice) / navPerShare) * 100 : null;

  return {
    constituents: constituents.sort((a, b) => b.value - a.value),
    unlistedHoldings,
    listedValue,
    unlistedValue: unlistedTotal,
    netDebt: i.netDebtPkr,
    navTotal,
    sharesOutstanding: i.sharesOutstanding,
    navPerShare,
    marketPrice: i.marketPrice,
    marketCap: i.marketPrice * i.sharesOutstanding,
    discountPct,
    yourMarketValue: i.heldShares * i.marketPrice,
    yourLookThroughValue: i.heldShares * navPerShare,
    missingPrices: constituents.filter((c) => !c.priced).map((c) => c.symbol),
  };
}

// Derive shares outstanding from financials when not given: profit / EPS.
export function deriveSharesOutstanding(latestProfitThousands: number | null, latestEps: number | null): number {
  if (latestProfitThousands == null || latestEps == null || latestEps === 0) return 0;
  return (latestProfitThousands * 1000) / latestEps;
}
