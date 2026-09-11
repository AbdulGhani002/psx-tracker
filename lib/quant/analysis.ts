// The model's own reading of the market and of each name, with the zones it
// would write down itself. Nothing here looks at the owner's bands; those
// are shown beside the verdict as a note, not as its cause.
//
// The reading uses only what the 24-year test showed to hold up:
//
//   market strength   the equal-weight index against its 200-day average and
//                     the share of names above theirs, the gate the rule test
//                     opened and shut on; beside it, eight chart tests a person
//                     would tick off, and what the KSE-100 did after past days
//                     in the same state (outlook.ts), with the count behind it
//   the name's rank   where its rank score sits among every name in the
//                     universe that day (rank IC about +0.09, t above 7 over
//                     24 years; the one durable signal), and what names ranked
//                     there went on to do against the market
//   the trend         above or below its own averages
//   the zones         read off the model's curve of where the path stalls
//                     (projection.ts): the buy zone from the median low to the
//                     quarter low, the fail level at the tenth-of-paths low,
//                     the sell zone from the median high to the quarter high
//   the dip odds      whether a 5% lower price is likely first, which decides
//                     whether a buy is taken now or worked in the zone

import type { TrendRead } from "./features";
import { tickFor, type PathLevels } from "./projection";
import type { CellOutlook, OutlookRecord, StrengthTest } from "./outlook";

export type MarketState = "STRONG" | "MIXED" | "WEAK";

export type MarketRead = {
  state: MarketState;
  indexAbove200: boolean; // the equal-weight index
  breadth200Pct: number; // share of names above their 200-day, in percent
  breadth50Pct: number;
  ewLevel: number | null;
  ewMa200: number | null;
  ewGapPct: number | null; // how far the 200-day sits above (+) or below (-) the equal-weight index
  tests: StrengthTest[]; // the KSE-100's chart tests
  score: number; // how many pass
  outlook: CellOutlook | null; // what the KSE-100 did after past days like this
  outlookRecord: OutlookRecord | null;
  line: string; // the state, in a sentence
  outlookLine: string; // the outlook, in a sentence
};

const pct = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
const odds = (p: number) => `${Math.round(p * 100)}%`;
const fmt = (v: number) => (v >= 10000 ? Math.round(v).toLocaleString("en-US") : v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));

export function readMarket(args: {
  indexAbove200: boolean;
  ewLevel: number | null;
  ewMa200: number | null;
  breadth200Pct: number;
  breadth50Pct: number;
  tests?: StrengthTest[];
  outlook?: CellOutlook | null;
  outlookRecord?: OutlookRecord | null;
  breadthFloorPct?: number;
}): MarketRead {
  const { indexAbove200, ewLevel, ewMa200, breadth200Pct, breadth50Pct } = args;
  const floor = args.breadthFloorPct ?? 40;
  const broad = breadth200Pct >= floor;
  const state: MarketState = indexAbove200 && broad ? "STRONG" : indexAbove200 ? "MIXED" : "WEAK";
  const tests = args.tests ?? [];
  const score = tests.filter((t) => t.pass).length;
  const ewGapPct = ewMa200 != null && ewLevel != null ? (ewMa200 / ewLevel - 1) * 100 : null;
  const scoreText = tests.length ? ` (${score} of ${tests.length} strength tests pass)` : "";
  const line =
    state === "STRONG"
      ? `Market strong${scoreText}: the equal-weight index is above its 200-day and ${breadth200Pct.toFixed(0)}% of names are above theirs. The rule is fully invested here.`
      : state === "MIXED"
      ? `Market mixed${scoreText}: the equal-weight index is above its 200-day but only ${breadth200Pct.toFixed(0)}% of names are above theirs. The rule buys only the strongest names here.`
      : `Market weak${scoreText}: the equal-weight index is below its 200-day and ${breadth200Pct.toFixed(0)}% of names are above theirs. The rule holds cash here and adds nothing until the index reclaims its 200-day${ewGapPct != null ? ` (${ewGapPct.toFixed(1)}% above)` : ""}.`;
  const o = args.outlook ?? null;
  const outlookLine = o
    ? `KSE-100 after past days like this (${o.label}; ${Math.round(o.periods)} periods since 1998): higher ${o.horizon} sessions later ${odds(o.pUp)} of the time against ${odds(o.base.pUp)} in all periods; median move ${pct(o.medianPct)}; a 5% dip first ${odds(o.pDip)} of the time. Middle range ${fmt(o.levels[1])} to ${fmt(o.levels[3])}, wide range ${fmt(o.levels[0])} to ${fmt(o.levels[4])}.`
    : "";
  return { state, indexAbove200, breadth200Pct, breadth50Pct, ewLevel, ewMa200, ewGapPct, tests, score, outlook: o, outlookRecord: args.outlookRecord ?? null, line, outlookLine };
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
  fails: number; // below it the case is gone: only a tenth of paths like this one go there
  trigger: number | null; // for names below their averages, the level a close must clear first
};

export type NameRead = {
  verdict: ModelVerdict;
  standing: NameStanding;
  pctile: number | null;
  zone: ModelZone;
  edge: string; // what names ranked here did against the market
  line: string;
};

// The level a falling name must clear before it counts as turning: the
// nearest of its 50-day, 20-day high and 200-day that sits at least 1% above.
export function triggerFor(price: number, ma50: number | null, ma200: number | null, high20: number): number | null {
  const cands = [ma50, high20, ma200].filter((v): v is number => v != null && v > price * 1.01);
  if (cands.length === 0) return null;
  const tick = tickFor(price);
  return Math.round(Math.min(...cands) / tick) * tick;
}

export type DecileEdge = { decile: number; meanRelPct: number; beatRate: number } | null;

export function edgeLine(edge: DecileEdge, horizon: number): string {
  if (!edge) return "";
  const where = edge.decile >= 10 ? "the top tenth" : edge.decile >= 9 ? "the second tenth" : edge.decile <= 1 ? "the bottom tenth" : edge.decile <= 2 ? "the second-lowest tenth" : `tenth ${edge.decile} of 10 (10 is the top)`;
  return `names ranked in ${where} went on to ${edge.meanRelPct >= 0 ? "beat" : "trail"} the market by ${Math.abs(edge.meanRelPct).toFixed(1)}% per ${horizon} sessions on average, out of sample since 2007`;
}

export function readName(args: {
  held: boolean;
  market: MarketState;
  pctile: number | null; // standing among the universe on the rank score, 0..1, 1 = strongest (averaged over recent sessions)
  rank?: { pos: number; of: number } | null; // today's place
  rank5?: { pos: number; of: number } | null; // the average place over the last five sessions, when it differs
  edge?: DecileEdge;
  trend: TrendRead | null;
  price: number;
  levels: PathLevels;
  trigger: number | null;
  ma200: number | null;
  pDip: number;
  dipUsable: boolean; // the dip record clears the bar
  horizon: number;
}): NameRead {
  const { held, market, pctile, rank, trend, price, levels, pDip, dipUsable, horizon } = args;
  const standing = standingOf(pctile);
  const t = trend?.label ?? "SIDEWAYS";
  const falling = t === "DOWNTREND" || t === "WEAKENING";
  const zone: ModelZone = { buyLow: levels.buyLow, buyHigh: levels.buyHigh, sellLow: levels.sellLow, sellHigh: levels.sellHigh, fails: levels.fails, trigger: falling ? args.trigger : null };
  const inSell = price >= levels.sellLow;
  const r5 = args.rank5;
  const rankText = rank ? `rank ${rank.pos} of ${rank.of}${r5 && Math.abs(r5.pos - rank.pos) >= 5 ? `, ${r5.pos} on average over the last five sessions` : ""}` : pctile != null ? `${standing.toLowerCase()} rank` : "unranked";
  const buyZone = `${fmt(levels.buyHigh)} down to ${fmt(levels.buyLow)}`;
  const sellZone = `${fmt(levels.sellLow)} to ${fmt(levels.sellHigh)}`;
  const failsAt = `The case fails below ${fmt(levels.fails)}`;
  const dipText = dipUsable ? ` (${odds(pDip)} odds of a 5% dip first)` : "";
  const edge = edgeLine(args.edge ?? null, horizon);

  let verdict: ModelVerdict;
  let line: string;

  if (standing === "WEAK") {
    if (held) {
      verdict = market === "WEAK" || falling ? "SELL" : "TRIM";
      line =
        verdict === "SELL"
          ? `Bottom-fifth name (${rankText}) in a ${market === "WEAK" ? "weak market" : "downtrend"}. Sell: into ${sellZone} if it gets there (half of paths like this one reach ${fmt(levels.sellLow)}), and out below ${fmt(levels.fails)} regardless.`
          : `Bottom-fifth name (${rankText}). Trim into ${sellZone}. ${failsAt}.`;
    } else {
      verdict = "AVOID";
      line = `Bottom-fifth name (${rankText}). Not a buy at any level while it ranks here.`;
    }
  } else if (standing === "STRONG") {
    if (market === "WEAK") {
      verdict = held ? "HOLD" : "WAIT";
      line = `Top-fifth name (${rankText}) in a weak market. ${held ? "Keep it. Add" : "Buy"} only in ${buyZone}, and only once the index is back above its 200-day. ${failsAt}. Sell zone ${sellZone}.`;
    } else if (falling) {
      verdict = "WATCH";
      line = `Top-fifth name (${rankText}) still under its ${t === "DOWNTREND" ? "50- and 200-day" : "50-day"} average. Buy on a close above ${zone.trigger ? fmt(zone.trigger) : "its 50-day"}, or in ${buyZone} if it holds there${dipText}. ${failsAt}.`;
    } else if (dipUsable && pDip >= 0.55) {
      verdict = "STAGE";
      line = `Top-fifth name (${rankText}), trend intact, market ${market.toLowerCase()}. ${odds(pDip)} odds of a 5% lower price first, so work the orders in ${buyZone} rather than paying up. Sell zone ${sellZone}. ${failsAt}.`;
    } else {
      verdict = "BUY";
      line = `Top-fifth name (${rankText}), trend intact, market ${market.toLowerCase()}. Buy: half now, half in ${buyZone}${dipText}. Sell zone ${sellZone}. ${failsAt}.`;
    }
  } else {
    if (held) {
      verdict = inSell ? "TRIM" : "HOLD";
      line = inSell
        ? `Middle-ranked name (${rankText}), already inside its sell zone (${sellZone}). Take some off. ${failsAt}.`
        : `Middle-ranked name (${rankText}). Nothing to add. Trim in ${sellZone}; ${failsAt.charAt(0).toLowerCase() + failsAt.slice(1)}.`;
    } else {
      verdict = "PASS";
      line = `Middle-ranked name (${rankText}). There are stronger names for new money.`;
    }
  }
  return { verdict, standing, pctile, zone, edge, line };
}

// Sort order for the report: what needs doing first.
export const VERDICT_RANK: Record<ModelVerdict, number> = { BUY: 0, STAGE: 1, SELL: 2, TRIM: 3, WATCH: 4, WAIT: 5, HOLD: 6, AVOID: 7, PASS: 8 };
