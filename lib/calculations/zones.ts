// Buy and sell ZONES: the price bands you decided on in advance, away from the
// screen. A zone is a pre-commitment — the alert engine and the rebalance page
// both read these, so the level that fires a Telegram ping is the same level
// that sizes the order.
//
// Two disciplines are enforced here rather than left to the caller:
//   1. A minimum position size per symbol. Being told to sell 8 shares of a
//      143-rupee stock is noise: the brokerage eats the trade and the position
//      barely moves. Below your own floor, the sell side stays quiet.
//   2. Contradictory config never produces an instruction. Overlapping buy and
//      sell bands, or a low above its high, yield a "conflict" status and a
//      plain-language warning — never a guessed side.
//
// Pure arithmetic. No I/O, no dates, no rounding of your money.

export type ZoneEntry = {
  symbol: string;
  buyZoneLow: number | null; // floor of the buy band; null = open-ended below
  buyZoneHigh: number | null; // "buy at or under this"; null = no buy zone set
  sellZoneLow: number | null; // "sell at or above this"; null = no sell zone set
  sellZoneHigh: number | null; // ceiling of the sell band; null = open-ended above
  minSellShares: number; // hold MORE than this before a sell is ever suggested
};

export type ZoneStatus =
  | "buy" // price is inside the buy band
  | "sell" // price is inside the sell band
  | "between" // between the bands — the honest "do nothing"
  | "no_zone" // no band configured on the side that would apply
  | "conflict" // the bands contradict each other; no instruction is emitted
  | "unknown"; // no usable price — never treated as cheap or dear

export type ZoneVerdict = {
  symbol: string;
  status: ZoneStatus;
  price: number | null;
  warnings: string[];
};

// Config sanity, checked before any price is compared. Returned as plain
// sentences because they are shown to the user verbatim.
export function zoneWarnings(e: ZoneEntry): string[] {
  const w: string[] = [];
  const bad = (v: number | null) => v != null && (!Number.isFinite(v) || v <= 0);
  if (bad(e.buyZoneLow) || bad(e.buyZoneHigh) || bad(e.sellZoneLow) || bad(e.sellZoneHigh)) {
    w.push(`${e.symbol}: a zone price must be greater than zero.`);
  }
  if (e.buyZoneLow != null && e.buyZoneHigh != null && e.buyZoneLow > e.buyZoneHigh) {
    w.push(`${e.symbol}: buy zone floor (Rs ${e.buyZoneLow}) is above its ceiling (Rs ${e.buyZoneHigh}).`);
  }
  if (e.sellZoneLow != null && e.sellZoneHigh != null && e.sellZoneLow > e.sellZoneHigh) {
    w.push(`${e.symbol}: sell zone floor (Rs ${e.sellZoneLow}) is above its ceiling (Rs ${e.sellZoneHigh}).`);
  }
  if (e.buyZoneHigh != null && e.sellZoneLow != null && e.sellZoneLow <= e.buyZoneHigh) {
    w.push(
      `${e.symbol}: the sell zone starts at Rs ${e.sellZoneLow}, at or below where the buy zone ends (Rs ${e.buyZoneHigh}) — ` +
        `one price would mean both buy and sell. No instruction is given until the bands are separated.`
    );
  }
  if (e.minSellShares < 0 || !Number.isFinite(e.minSellShares)) {
    w.push(`${e.symbol}: the minimum sell size must be zero or more shares.`);
  }
  return w;
}

function inBuyBand(price: number, e: ZoneEntry): boolean {
  if (e.buyZoneHigh == null || !(e.buyZoneHigh > 0)) return false;
  if (price > e.buyZoneHigh) return false;
  if (e.buyZoneLow != null && e.buyZoneLow > 0 && price < e.buyZoneLow) return false;
  return true;
}

function inSellBand(price: number, e: ZoneEntry): boolean {
  if (e.sellZoneLow == null || !(e.sellZoneLow > 0)) return false;
  if (price < e.sellZoneLow) return false;
  if (e.sellZoneHigh != null && e.sellZoneHigh > 0 && price > e.sellZoneHigh) return false;
  return true;
}

export function evaluateZone(price: number | null | undefined, e: ZoneEntry): ZoneVerdict {
  const warnings = zoneWarnings(e);
  const usablePrice = price != null && Number.isFinite(price) && price > 0 ? price : null;
  if (warnings.length > 0) {
    return { symbol: e.symbol, status: "conflict", price: usablePrice, warnings };
  }
  if (usablePrice == null) {
    // A missing price is not a cheap price. Say unknown and stop.
    return { symbol: e.symbol, status: "unknown", price: null, warnings };
  }
  const buy = inBuyBand(usablePrice, e);
  const sell = inSellBand(usablePrice, e);
  if (buy && sell) {
    return {
      symbol: e.symbol,
      status: "conflict",
      price: usablePrice,
      warnings: [`${e.symbol}: Rs ${usablePrice} falls in both your buy and sell bands.`],
    };
  }
  if (buy) return { symbol: e.symbol, status: "buy", price: usablePrice, warnings };
  if (sell) return { symbol: e.symbol, status: "sell", price: usablePrice, warnings };
  const anyZone = e.buyZoneHigh != null || e.sellZoneLow != null;
  return { symbol: e.symbol, status: anyZone ? "between" : "no_zone", price: usablePrice, warnings };
}

// The sell gate. A sell is only ever suggested when the price is in the band
// AND the position is bigger than the floor you set for this symbol. Exactly
// at the floor is NOT above it — the floor is a size you keep, not a trigger.
export function shouldSuggestSell(status: ZoneStatus, sharesHeld: number, minSellShares: number): boolean {
  if (status !== "sell") return false;
  if (!Number.isFinite(sharesHeld) || sharesHeld <= 0) return false;
  const floor = Number.isFinite(minSellShares) && minSellShares > 0 ? minSellShares : 0;
  return sharesHeld > floor;
}

// How far today's price sits from the nearest edge of the band it is heading
// toward, as a percentage. Used for the "approaching" heads-up and for sorting
// a watchlist by what is closest to acting. null when the relevant band is unset.
export function distanceToZonePct(price: number, e: ZoneEntry): { toBuyPct: number | null; toSellPct: number | null } {
  const ok = Number.isFinite(price) && price > 0;
  const toBuyPct =
    ok && e.buyZoneHigh != null && e.buyZoneHigh > 0 ? ((price - e.buyZoneHigh) / price) * 100 : null;
  const toSellPct =
    ok && e.sellZoneLow != null && e.sellZoneLow > 0 ? ((e.sellZoneLow - price) / price) * 100 : null;
  return { toBuyPct, toSellPct };
}

// Human-readable band, for alerts and table cells. Never prints a fake bound.
export function describeZone(low: number | null, high: number | null, side: "buy" | "sell"): string {
  if (side === "buy") {
    if (high == null) return "no buy zone";
    return low == null ? `at or under Rs ${high}` : `Rs ${low}–${high}`;
  }
  if (low == null) return "no sell zone";
  return high == null ? `at or above Rs ${low}` : `Rs ${low}–${high}`;
}

// Validate a loosely-typed record (an API body merged over a stored row) as if
// it were a zone entry. Used at the API edge so contradictory bands are refused
// before they can reach the database and confuse the alert engine.
export function zoneWarningsFrom(symbol: string, v: Record<string, unknown>): string[] {
  const n = (k: string): number | null => {
    const raw = v[k];
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  };
  return zoneWarnings({
    symbol,
    buyZoneLow: n("buyZoneLow"),
    buyZoneHigh: n("buyZoneHigh"),
    sellZoneLow: n("sellZoneLow"),
    sellZoneHigh: n("sellZoneHigh"),
    minSellShares: n("minSellShares") ?? 0,
  });
}
