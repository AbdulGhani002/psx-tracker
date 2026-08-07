// "What moved my portfolio?" — the period's change split into per-holding
// rupee contributions, so the overview can say WHY it moved, not just that it
// did.
//
// Method: for each held position, contribution = shares_today × (price_now −
// price_then). This is price-move attribution over CURRENT shares — honest for
// a portfolio like this one (few trades), and we say exactly what it is:
//   - a position BOUGHT inside the window contributes from its buy price
//     only if we have no earlier quote; we use the oldest price INSIDE the
//     window and flag the shorter span rather than inventing a start price.
//   - dividends are not price moves and are reported separately by the caller.
// A symbol with no usable series is EXCLUDED and listed, never guessed.

export type AttributionInput = {
  positions: Array<{ symbol: string; shares: number; priceKnown: boolean; currentPrice: number }>;
  // Ascending EOD closes per symbol: [{date: "YYYY-MM-DD", close}]
  series: Map<string, Array<{ date: string; close: number }>>;
  sinceIso: string; // window start (inclusive), e.g. 30 days ago
};

export type Contribution = {
  symbol: string;
  changePkr: number; // shares × (now − then)
  pricePct: number; // (now − then) / then
  priceThen: number;
  priceNow: number;
  thenDate: string; // the actual date used (>= sinceIso; later when data starts inside the window)
  partialWindow: boolean; // true when the series doesn't reach back to sinceIso
};

export type Attribution = {
  contributions: Contribution[]; // sorted, biggest absolute mover first
  totalChangePkr: number;
  excluded: Array<{ symbol: string; reason: string }>;
  sinceIso: string;
};

export function computeAttribution(i: AttributionInput): Attribution {
  const contributions: Contribution[] = [];
  const excluded: Attribution["excluded"] = [];

  for (const p of i.positions) {
    if (p.shares <= 0) continue;
    if (!p.priceKnown || p.currentPrice <= 0) {
      excluded.push({ symbol: p.symbol, reason: "no current price" });
      continue;
    }
    const s = i.series.get(p.symbol);
    if (!s || s.length === 0) {
      excluded.push({ symbol: p.symbol, reason: "no price history" });
      continue;
    }
    // Oldest close ON/AFTER the window start. The series is ascending; entries
    // before the window are ignored, and if the series STARTS inside the window
    // (new listing / data gap) we use its first point and flag it.
    const inWindow = s.filter((x) => x.date >= i.sinceIso && x.close > 0);
    if (inWindow.length === 0) {
      excluded.push({ symbol: p.symbol, reason: "no quotes inside the window" });
      continue;
    }
    const first = inWindow[0];
    const hasFullWindow = s.some((x) => x.date <= i.sinceIso && x.close > 0);
    // Prefer the last close BEFORE the window as "then" (true period change);
    // fall back to the first close inside it.
    const before = [...s].reverse().find((x) => x.date <= i.sinceIso && x.close > 0);
    const then = before ?? first;
    if (then.close <= 0) {
      excluded.push({ symbol: p.symbol, reason: "bad historical quote" });
      continue;
    }
    contributions.push({
      symbol: p.symbol,
      changePkr: p.shares * (p.currentPrice - then.close),
      pricePct: (p.currentPrice - then.close) / then.close,
      priceThen: then.close,
      priceNow: p.currentPrice,
      thenDate: then.date,
      partialWindow: !hasFullWindow,
    });
  }

  contributions.sort((a, b) => Math.abs(b.changePkr) - Math.abs(a.changePkr));
  return {
    contributions,
    totalChangePkr: contributions.reduce((s, c) => s + c.changePkr, 0),
    excluded,
    sinceIso: i.sinceIso,
  };
}
