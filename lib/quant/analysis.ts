// The model's own reading of the market and of each name, with the zones it
// would write down itself. Nothing here looks at the owner's bands; those
// are shown beside the verdict as a note, not as its cause.
//
// The reading uses only what the 24-year test showed to hold up:
//
//   market strength   the equal-weight index against its 200-day average and
//                     the share of names above theirs, the gate the rule test
//                     opened and shut on
//   the name's rank   where its odds of beating the market sit among every
//                     name in the universe that day (rank IC +0.08, t 7.4 over
//                     24 years; the one durable signal)
//   the trend         above or below its own averages
//   the dip odds      whether a 5% lower price is likely first, which decides
//                     whether a buy is taken or staged
//
// Zones come from the name's own volatility around the model's centre (see
// projection.ts), and the level where the case fails is the 20-day low.

import type { TrendRead } from "./features";
import type { Projection, ModelBands } from "./projection";

export type MarketState = "STRONG" | "MIXED" | "WEAK";

export type MarketRead = {
  state: MarketState;
  indexAbove200: boolean;
  breadth200Pct: number; // share of names above their 200-day, in percent
  breadth50Pct: number;
  ewLevel: number | null;
  ewMa200: number | null;
  line: string;
};

export function readMarket(indexAbove200: boolean, ewLevel: number | null, ewMa200: number | null, breadth200Pct: number, breadth50Pct: number, breadthFloorPct = 40): MarketRead {
  const broad = breadth200Pct >= breadthFloorPct;
  const state: MarketState = indexAbove200 && broad ? "STRONG" : indexAbove200 ? "MIXED" : "WEAK";
  const line =
    state === "STRONG"
      ? `Market strong: the equal-weight index is above its 200-day and ${breadth200Pct.toFixed(0)}% of names are above theirs. The rule is fully invested here.`
      : state === "MIXED"
      ? `Market mixed: the equal-weight index is above its 200-day but only ${breadth200Pct.toFixed(0)}% of names are above theirs. The rule buys only the strongest names here.`
      : `Market weak: the equal-weight index is below its 200-day and ${breadth200Pct.toFixed(0)}% of names are above theirs. The rule holds cash here and adds nothing until the index reclaims its 200-day${ewMa200 != null && ewLevel != null ? ` (${((ewMa200 / ewLevel - 1) * 100).toFixed(1)}% above)` : ""}.`;
  return { state, indexAbove200, breadth200Pct, breadth50Pct, ewLevel, ewMa200, line };
}

export type NameStanding = "STRONG" | "MIDDLE" | "WEAK";

export function standingOf(pctile: number | null): NameStanding {
  if (pctile == null) return "MIDDLE";
  return pctile >= 0.8 ? "STRONG" : pctile <= 0.2 ? "WEAK" : "MIDDLE";
}

export type ModelVerdict = "BUY" | "STAGE" | "WATCH" | "HOLD" | "TRIM" | "SELL" | "WAIT" | "AVOID" | "PASS";

export type ModelZone = {
  buyLow: number;
  buyHigh: number;
  sellLow: number;
  sellHigh: number;
  fails: number; // the lower of the 20-day low and the buy-zone floor: below it the case is gone
  trigger: number | null; // the 50-day, for names that must reclaim it first
};

export type NameRead = {
  verdict: ModelVerdict;
  standing: NameStanding;
  pctile: number | null;
  zone: ModelZone;
  line: string;
};

const fmt = (v: number) => (v >= 10000 ? Math.round(v).toLocaleString("en-US") : v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
const odds = (p: number) => `${Math.round(p * 100)}%`;

export function readName(args: {
  held: boolean;
  market: MarketState;
  pctile: number | null; // rank of p(beat) among the universe, 0..1, 1 = strongest
  rank?: { pos: number; of: number } | null; // the same, as "4 of 90", for the words
  trend: TrendRead | null;
  price: number;
  projection: Projection;
  bands: ModelBands;
  pDip: number;
  dipUsable: boolean; // the dip record clears the bar
}): NameRead {
  const { held, market, pctile, rank, trend, price, projection, bands, pDip, dipUsable } = args;
  const standing = standingOf(pctile);
  const t = trend?.label ?? "SIDEWAYS";
  const falling = t === "DOWNTREND" || t === "WEAKENING";
  // A name sitting on its 20-day low would otherwise "fail" at today's price;
  // the buy-zone floor is the lower bound the model itself stands behind.
  const fails = Math.min(projection.low20, bands.buyLow);
  const zone: ModelZone = { ...bands, fails, trigger: falling ? projection.ma50 : null };
  const inBuy = price <= bands.buyHigh;
  const inSell = price >= bands.sellLow;
  const rankText = rank ? `rank ${rank.pos} of ${rank.of} on the model's odds of beating the market` : pctile != null ? `${standing.toLowerCase()} on the model's odds of beating the market` : "unranked";
  const buyZone = `buy ${fmt(bands.buyLow)} to ${fmt(bands.buyHigh)}`;
  const sellZone = `sell ${fmt(bands.sellLow)} to ${fmt(bands.sellHigh)}`;
  const failsAt = `The case fails below ${fmt(fails)}`;

  let verdict: ModelVerdict;
  let line: string;

  if (standing === "WEAK") {
    if (held) {
      verdict = market === "WEAK" || falling ? "SELL" : "TRIM";
      line =
        verdict === "SELL"
          ? `Weak name (${rankText}) in a ${market === "WEAK" ? "weak market" : "downtrend"}. Sell into any strength: ${sellZone} if it gets there, and out below ${fmt(fails)} regardless.`
          : `Weak name (${rankText}). Trim into strength: ${sellZone}. ${failsAt}.`;
    } else {
      verdict = "AVOID";
      line = `Weak name (${rankText}). Not a buy at any of these levels while it ranks here.`;
    }
  } else if (standing === "STRONG") {
    if (market === "WEAK") {
      verdict = held ? "HOLD" : "WAIT";
      line = `Strong name (${rankText}) in a weak market. ${held ? "Keep it; add" : "Buy"} only at the band low, ${fmt(bands.buyLow)}, and only once the index reclaims its 200-day. ${failsAt}.`;
    } else if (falling) {
      verdict = "WATCH";
      line = `Strong name (${rankText}) but still under its ${t === "DOWNTREND" ? "50- and 200-day" : "50-day"} average. Buy on a close back above the 50-day${projection.ma50 ? ` (${fmt(projection.ma50)})` : ""}; until then ${buyZone} is where a dip would be worth catching. ${failsAt}.`;
    } else if (dipUsable && pDip >= 0.55) {
      verdict = "STAGE";
      line = `Strong name (${rankText}), trend intact, market ${market.toLowerCase()}. ${odds(pDip)} odds of a 5% lower price first, so half now and half at ${fmt(bands.buyLow)} to ${fmt(bands.buyHigh)}. ${sellZone.charAt(0).toUpperCase() + sellZone.slice(1)}. ${failsAt}.`;
    } else {
      verdict = "BUY";
      line = inBuy
        ? `Strong name (${rankText}), trend intact, market ${market.toLowerCase()}, price inside the model's buy zone. Buy up to ${fmt(bands.buyHigh)}; ${sellZone}. ${failsAt}.`
        : `Strong name (${rankText}), trend intact, market ${market.toLowerCase()}. Buy on a pullback into ${fmt(bands.buyLow)} to ${fmt(bands.buyHigh)}${dipUsable ? ` (dip odds ${odds(pDip)})` : ""}; ${sellZone}. ${failsAt}.`;
    }
  } else {
    // Middle of the pack.
    if (held) {
      verdict = inSell ? "TRIM" : "HOLD";
      line = inSell
        ? `Middling name (${rankText}), already inside the model's sell zone (${sellZone}). Take some off. ${failsAt}.`
        : `Middling name (${rankText}). Nothing to add. If it ranked higher, ${fmt(bands.buyLow)} to ${fmt(bands.buyHigh)} would be the place to buy; the model would ${sellZone}. ${failsAt}.`;
    } else {
      verdict = "PASS";
      line = `Middling name (${rankText}). There are stronger names for new money; ${buyZone} only if it climbs into the top fifth.`;
    }
  }
  return { verdict, standing, pctile, zone, line };
}

// Sort order for the report: what needs doing first.
export const VERDICT_RANK: Record<ModelVerdict, number> = { BUY: 0, STAGE: 1, SELL: 2, TRIM: 3, WATCH: 4, WAIT: 5, HOLD: 6, AVOID: 7, PASS: 8 };
