// Buy and sell ZONES: the price bands you decided on in advance, away from the
// screen. A zone is a pre-commitment — the alert engine, the watchlist table and
// the rebalance deployment plan all read these, so the level that fires a
// Telegram ping is the same level that sizes the order.
//
// Two disciplines are enforced here rather than left to the caller:
//
//   1. A MINIMUM HOLDING per symbol: the share count you always keep, whatever
//      the price does. Only the excess above that floor is ever offered for
//      sale, so a core position cannot be talked out from under you and a
//      position at or under the floor stays silent.
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
  minHoldingShares: number; // shares you ALWAYS keep — only the excess is sold
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
  if (e.minHoldingShares < 0 || !Number.isFinite(e.minHoldingShares)) {
    w.push(`${e.symbol}: the minimum holding must be zero or more shares.`);
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

// How many shares the sell zone actually frees: everything ABOVE the minimum
// holding, and not one share more. Hold 1,200 with a floor of 1,000 and the
// answer is 200. Hold 900 against the same floor and the answer is zero — the
// position is already at or under the core you keep, so nothing is suggested.
export function sellableShares(status: ZoneStatus, sharesHeld: number, minHoldingShares: number): number {
  if (status !== "sell") return 0;
  if (!Number.isFinite(sharesHeld) || sharesHeld <= 0) return 0;
  const floor = Number.isFinite(minHoldingShares) && minHoldingShares > 0 ? minHoldingShares : 0;
  return Math.max(0, Math.floor(sharesHeld - floor));
}

// --- How hard to buy, given where the price sits -----------------------------
// In the band, buy at full weight. Above it, buy LESS the further away it is —
// a linear taper that reaches a trickle 25 points above your ceiling. In a sell
// band, buy nothing: adding to a position you are trying to exit is incoherent.
// Below the band it is cheaper than you planned, which is not a reason to buy
// less, so full weight stands and the caller is told why.

export const BUY_DECAY_SPAN_PCT = 25; // points above the ceiling to full taper
export const BUY_MIN_FACTOR = 0.15; // never quite zero — still your name
export const NO_ZONE_FACTOR = 0.35; // no band set: cheapness unproven, go light

export type BuyWeight = { factor: number; reason: string };

// STRICT changes the question from "how much should I buy here" to "is this a
// price I said I would pay". Outside the band the answer is no and the money
// stays in cash until the price comes to you, rather than trickling in above
// your own ceiling. A name with no band set is not in a band, so it is not
// bought either — cheapness unproven is not the same as cheap.
export function zoneBuyFactor(
  price: number | null | undefined,
  e: ZoneEntry,
  strict = false
): BuyWeight {
  const v = evaluateZone(price, e);
  if (v.status === "conflict") return { factor: 0, reason: "zones contradict each other" };
  if (v.status === "unknown" || v.price == null) return { factor: 0, reason: "no usable price" };
  if (v.status === "sell") return { factor: 0, reason: "in your sell zone — not a buy" };
  if (v.status === "buy") return { factor: 1, reason: "in your buy zone" };
  if (v.status === "no_zone") {
    return strict
      ? { factor: 0, reason: "no buy zone set — nothing to buy against, so the money waits" }
      : { factor: NO_ZONE_FACTOR, reason: "no buy zone set — reduced weight" };
  }

  // "between": either under the band floor, or above the ceiling.
  if (e.buyZoneLow != null && v.price < e.buyZoneLow) {
    return { factor: 1, reason: `below your buy band (Rs ${e.buyZoneLow}) — cheaper than planned` };
  }
  if (e.buyZoneHigh != null && e.buyZoneHigh > 0) {
    const abovePct = ((v.price - e.buyZoneHigh) / e.buyZoneHigh) * 100;
    if (strict) {
      return {
        factor: 0,
        reason: `${abovePct.toFixed(1)}% above your buy ceiling of Rs ${e.buyZoneHigh} — waiting for it to come back`,
      };
    }
    const factor = Math.max(BUY_MIN_FACTOR, 1 - abovePct / BUY_DECAY_SPAN_PCT);
    return { factor, reason: `${abovePct.toFixed(1)}% above your buy ceiling — reduced weight` };
  }
  // Only a sell band is set and the price is under it.
  return strict
    ? { factor: 0, reason: "no buy zone set — nothing to buy against, so the money waits" }
    : { factor: NO_ZONE_FACTOR, reason: "no buy zone set — reduced weight" };
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
    minHoldingShares: n("minHoldingShares") ?? n("minSellShares") ?? 0,
  });
}
