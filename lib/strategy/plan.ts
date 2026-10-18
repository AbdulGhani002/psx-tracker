// The downturn playbook: what disciplined money does in a mandi, as rules
// applied to the market, the month's rates and the portfolio.
//
//   phase       how far the KSE-100 is below its 52-week high:
//               calm (< 5%), pullback (5-10%), correction (10-20%),
//               mandi (20-30%), crash (30% or more)
//   valuation   what the market earns on its price (1 / P/E, and 1 / CAPE)
//               against the 12-month T-bill: cheap 3 points or more above,
//               dear 1 point or more below, fair between
//   allocation  stocks' share by the risk profile (defensive 40%, balanced
//               60%, aggressive 80%), less 10 points for a medium horizon
//               and 20 for a short one, 10 more when stocks are cheap and 10
//               less when dear, 5 more in a mandi and 10 in a crash; the rest
//               is dry powder (cash, money market, T-bills, sukuks)
//   tranches    the room to buy (target less what is in stocks) goes in up to
//               four parts, more the deeper, into the buy zones of
//               lib/strategy/zones.ts (the model's zone, past lows, a bad
//               quarter, cheap against T-bills); a part whose zone the
//               KSE-100 has reached is due. Without zones, quarters at 5, 10,
//               20 and 30% below the high
//   parking     the dry powder waits where it earns most after tax for the
//               time it may be needed: the next tranches somewhere liquid,
//               the rest locked longer when rates are falling, shorter when
//               they are rising
//   quality     buy grade A and B names below the market's multiple (the
//               compounders) and A and B holdings 20% or more below their
//               intrinsic value (the margin of safety); reconsider holdings
//               that earn less than their cost of equity; dividends above
//               the T-bill rate noted
//
// These are rules over the data and the settings, not advice. No server
// imports, so scripts/test-strategy.ts can run it.

import { zoneWeights, type BuyZone, type ZoneKind } from "./zones";

export type RiskProfile = "defensive" | "balanced" | "aggressive";
export type Horizon = "short" | "medium" | "long";

export type Rates = {
  month: string; // yyyy-mm
  policyPct: number | null;
  tbill3mPct: number | null;
  tbill6mPct: number | null;
  tbill12mPct: number | null;
  sukukPct: number | null;
  savingsPct: number | null;
  moneyMarketPct: number | null;
  inflationPct: number | null;
  taxPct: number;
};

export type StrategyName = {
  symbol: string;
  held: boolean;
  value: number;
  grade: "A" | "B" | "C" | "D" | null;
  quadrant: "compounder" | "premium" | "trap" | "danger" | null;
  roeSpreadPp: number | null;
  dividendYieldPct: number | null;
  marginOfSafetyPct?: number | null;
};

export type StrategyInput = {
  today: string;
  profile: { risk: RiskProfile; horizon: Horizon };
  kse: { level: number; high: number; highDate: string; ma200: number | null } | null;
  market: { pe: number | null; cape: number | null; dividendYieldPct: number | null } | null;
  rates: Rates | null;
  prevRates: Rates | null;
  book: { stocks: number; equityFunds: number; cashLike: number; fixedIncome: number };
  names: StrategyName[];
  zones?: BuyZone[] | null; // lib/strategy/zones.ts, highest first
  // Where the dry powder already is: a money-market fund or savings account
  // (liquid, at its own yield) or a deposit, bill or sukuk (locked until it
  // matures). With these the parking line compares, instead of telling you to
  // park money that is already parked.
  places?: Array<{ label: string; amount: number; yieldPct: number | null; liquid: boolean; until?: string }>;
};

export type PhaseKey = "calm" | "pullback" | "correction" | "mandi" | "crash";
// A part of the buying: its zone (low to high; `kseLevel` is the top), why
// the zone is there, how far under the 52-week high its top is, the money.
export type Tranche = { n: number; kind: ZoneKind | "level"; low: number | null; high: number | null; why: string; drawdownPct: number; kseLevel: number | null; amount: number; due: boolean };
export type ParkOption = { key: string; label: string; words: string; yieldPct: number; afterTaxPct: number; liquidity: string; best?: boolean };

export type StrategyPlan = {
  phase: { key: PhaseKey; drawdownPct: number | null; belowMa200: boolean | null; line: string };
  valuation: { earningsYieldPct: number | null; capeYieldPct: number | null; tbillPct: number | null; premiumPp: number | null; realTbillPct: number | null; verdict: "cheap" | "fair" | "dear" | null; line: string };
  allocation: { total: number; stocksNowPct: number; stocksTargetPct: number; dryNowPct: number; dryTargetPct: number; room: number; line: string };
  tranches: Tranche[];
  rateTrend: { changePp: number | null; line: string };
  parking: { options: ParkOption[]; liquid: number; locked: number; line: string };
  quality: { add: StrategyName[]; reconsider: StrategyName[]; income: StrategyName[] };
  steps: string[];
};

export const PHASES: Record<PhaseKey, { label: string; text: string }> = {
  calm: { label: "Calm", text: "near its high: no sale on" },
  pullback: { label: "Pullback", text: "a pullback" },
  correction: { label: "Correction", text: "a correction" },
  mandi: { label: "Mandi", text: "a mandi (a bear market)" },
  crash: { label: "Crash", text: "a crash" },
};

export const TRANCHE_LEVELS = [5, 10, 20, 30]; // % below the 52-week high
const BASE_STOCKS: Record<RiskProfile, number> = { defensive: 40, balanced: 60, aggressive: 80 };
const HORIZON_CUT: Record<Horizon, number> = { short: 20, medium: 10, long: 0 };

const r1 = (v: number) => Math.round(v * 10) / 10;
const pct = (v: number) => `${r1(v)}%`;
const rs = (v: number) => `Rs ${Math.round(v).toLocaleString("en-US")}`;

// A zone as "158,900–162,450", or a single level.
export function zoneRange(t: Pick<Tranche, "low" | "high" | "kseLevel">): string {
  const f = (v: number) => Math.round(v).toLocaleString("en-US");
  return t.low != null && t.high != null && t.low < t.high ? `${f(t.low)}–${f(t.high)}` : t.kseLevel != null ? f(t.kseLevel) : "—";
}

export function phaseOf(drawdownPct: number | null): PhaseKey {
  if (drawdownPct == null) return "calm";
  const d = -drawdownPct;
  return d >= 30 ? "crash" : d >= 20 ? "mandi" : d >= 10 ? "correction" : d >= 5 ? "pullback" : "calm";
}

// The cash where it is, against the best a short bill or a fund pays after
// tax: switch only for a real gain (half a point or more), and money locked
// in a deposit stays put until it matures.
function placesLine(places: NonNullable<StrategyInput["places"]>, opts: ParkOption[], taxPct: number): string {
  const liquid = places.filter((p) => p.liquid && p.amount >= 1);
  const locked = places.filter((p) => !p.liquid && p.amount >= 1);
  const best = [...opts].filter((o) => ["tbill3m", "tbill6m", "mmf"].includes(o.key)).sort((a, b) => b.afterTaxPct - a.afterTaxPct)[0];
  const parts: string[] = [];
  for (const p of liquid) {
    const after = p.yieldPct != null ? p.yieldPct * (1 - taxPct / 100) : null;
    if (best && after != null && best.afterTaxPct - after >= 0.5) {
      parts.push(`${rs(p.amount)} in ${p.label} earns ${pct(after)} after tax; ${best.words} pay ${pct(best.afterTaxPct)}: about ${rs((p.amount * (best.afterTaxPct - after)) / 100)} a year more`);
    } else {
      parts.push(`${rs(p.amount)} in ${p.label}${after != null ? ` at ${pct(after)} after tax` : ""}: fine`);
    }
  }
  if (locked.length) parts.push(`${rs(locked.reduce((s, p) => s + p.amount, 0))} locked in ${locked.map((p) => `${p.label}${p.until ? ` to ${p.until}` : ""}`).join(", ")}`);
  return parts.length ? `Cash: ${parts.join("; ")}` : "";
}

export function strategyPlan(i: StrategyInput): StrategyPlan {
  // --- the phase
  const dd = i.kse && i.kse.high > 0 ? (i.kse.level / i.kse.high - 1) * 100 : null;
  const phaseKey = phaseOf(dd);
  const belowMa200 = i.kse?.ma200 ? i.kse.level < i.kse.ma200 : null;
  const phaseLine = dd == null ? "Market: no KSE-100 data" : `Market: ${PHASES[phaseKey].label}, KSE-100 ${pct(Math.abs(dd))} below its high`;

  // --- valuation against the T-bill
  const R = i.rates;
  const tbill = R ? R.tbill12mPct ?? R.tbill6mPct ?? R.tbill3mPct ?? R.policyPct : null;
  const ey = i.market?.pe && i.market.pe > 0 ? 100 / i.market.pe : null;
  const cy = i.market?.cape && i.market.cape > 0 ? 100 / i.market.cape : null;
  const premium = ey != null && tbill != null ? ey - tbill : null;
  const verdict = premium == null ? null : premium >= 3 ? "cheap" : premium < -1 ? "dear" : "fair";
  const realTbill = tbill != null && R?.inflationPct != null ? tbill - R.inflationPct : null;
  const valLine =
    ey == null || tbill == null
      ? "Enter this month's rates"
      : `Stocks earn ${pct(ey)}, T-bills ${pct(tbill)}: ${verdict}`;

  // --- allocation
  const total = i.book.stocks + i.book.equityFunds + i.book.cashLike + i.book.fixedIncome;
  const stocksNow = total > 0 ? ((i.book.stocks + i.book.equityFunds) / total) * 100 : 0;
  let target = BASE_STOCKS[i.profile.risk] - HORIZON_CUT[i.profile.horizon];
  if (verdict === "cheap") target += 10;
  if (verdict === "dear") target -= 10;
  if (phaseKey === "mandi") target += 5;
  if (phaseKey === "crash") target += 10;
  target = Math.max(20, Math.min(90, target));
  const room = Math.max(0, ((target - stocksNow) / 100) * total);
  const allocLine =
    total <= 0
      ? "Nothing to allocate yet."
      : room > 0
        ? `Stocks ${pct(stocksNow)}, target ${pct(target)}: ${rs(room)} to invest`
        : stocksNow > target + 5
          ? `Stocks ${pct(stocksNow)}, above the ${pct(target)} target: no buying`
          : `Stocks ${pct(stocksNow)}: on target`;

  // --- tranches: the room into the buy zones, more the deeper; without
  // zones, quarters at falling levels
  const zs = i.zones && i.zones.length > 0 && i.kse ? i.zones : null;
  const w = zoneWeights(zs ? zs.length : 0);
  const tranches: Tranche[] = zs
    ? zs.map((z, k) => ({
        n: k + 1,
        kind: z.kind,
        low: z.low,
        high: z.high,
        why: z.why,
        drawdownPct: i.kse!.high > 0 ? (1 - z.high / i.kse!.high) * 100 : 0,
        kseLevel: z.high,
        amount: room * w[k],
        due: i.kse!.level <= z.high,
      }))
    : TRANCHE_LEVELS.map((lv, k) => {
        const at = i.kse ? Math.round(i.kse.high * (1 - lv / 100)) : null;
        return { n: k + 1, kind: "level" as const, low: null, high: at, why: `${lv}% under the high`, drawdownPct: lv, kseLevel: at, amount: room / TRANCHE_LEVELS.length, due: dd != null && -dd >= lv };
      });

  // --- the rate's direction
  const change = R?.policyPct != null && i.prevRates?.policyPct != null ? R.policyPct - i.prevRates.policyPct : null;
  const trendLine = change == null ? "" : change < 0 ? `Rates falling (${r1(change)} pts): lock in longer` : change > 0 ? `Rates rising (+${r1(change)} pts): stay short` : "Rates unchanged";

  // --- where the dry powder waits
  const tax = R?.taxPct ?? 15;
  const opts: ParkOption[] = [];
  const add = (key: string, label: string, words: string, y: number | null | undefined, liquidity: string) => {
    if (y != null && y > 0) opts.push({ key, label, words, yieldPct: y, afterTaxPct: y * (1 - tax / 100), liquidity });
  };
  add("savings", "Savings account", "a savings account", R?.savingsPct, "any day");
  add("mmf", "Money market fund", "a money market fund", R?.moneyMarketPct, "a day or two");
  add("tbill3m", "3-month T-bill", "3-month T-bills", R?.tbill3mPct, "3 months");
  add("tbill6m", "6-month T-bill", "6-month T-bills", R?.tbill6mPct, "6 months");
  add("tbill12m", "12-month T-bill", "12-month T-bills", R?.tbill12mPct, "12 months");
  add("sukuk", "GoP Ijara sukuk", "GoP Ijara sukuks", R?.sukukPct, "years; sellable at a price");
  // The money for the steps not yet taken waits where it can be had in days
  // (a step can fall due any day); the rest of the dry powder target can be
  // locked: longer while rates fall, shorter while they rise.
  const waiting = tranches.filter((t) => !t.due).reduce((s, t) => s + t.amount, 0);
  const liquidPick = [...opts].filter((o) => o.key === "mmf" || o.key === "savings").sort((a, b) => b.afterTaxPct - a.afterTaxPct)[0];
  const lockKeys = change != null && change < 0 ? ["tbill12m", "sukuk", "tbill6m"] : change != null && change > 0 ? ["tbill3m", "mmf", "tbill6m"] : ["tbill6m", "tbill12m", "tbill3m"];
  const lockPick = lockKeys.map((k) => opts.find((o) => o.key === k)).find(Boolean) ?? liquidPick;
  for (const o of opts) if (o === liquidPick || o === lockPick) o.best = true;
  // The dry powder there is: the next steps' share liquid, the rest locked.
  const dryNow = i.book.cashLike + i.book.fixedIncome;
  const liquidAmt = Math.min(waiting, dryNow);
  const lockAmt = Math.max(0, dryNow - liquidAmt);
  const home = lockPick ?? liquidPick;
  const parts = [liquidAmt > 0 && liquidPick ? `${rs(liquidAmt)} in ${liquidPick.words} (${pct(liquidPick.afterTaxPct)})` : "", lockAmt > 0 && home ? `${rs(lockAmt)} in ${home.words} (${pct(home.afterTaxPct)})` : ""].filter(Boolean);
  const parkLine = i.places && i.places.some((p) => p.amount >= 1) ? placesLine(i.places, opts, tax) : opts.length === 0 ? "" : dryNow <= 0 ? (home ? `New cash: ${home.words} (${pct(home.afterTaxPct)} after tax)` : "") : `Park: ${parts.join(", ")}, after tax`;

  // --- flight to quality
  const good = (n: StrategyName) => n.grade === "A" || n.grade === "B";
  const addNames = i.names.filter((n) => good(n) && (n.quadrant === "compounder" || (n.held && (n.marginOfSafetyPct ?? -1) >= 20))).sort((a, b) => (b.roeSpreadPp ?? 0) - (a.roeSpreadPp ?? 0)).slice(0, 6);
  const reconsider = i.names.filter((n) => n.held && (n.grade === "D" || n.quadrant === "trap" || n.quadrant === "danger" || (n.roeSpreadPp != null && n.roeSpreadPp < -5))).sort((a, b) => b.value - a.value);
  const income = i.names.filter((n) => n.dividendYieldPct != null && tbill != null && n.dividendYieldPct >= tbill && (n.grade === "A" || n.grade === "B" || n.grade === "C")).sort((a, b) => (b.dividendYieldPct ?? 0) - (a.dividendYieldPct ?? 0)).slice(0, 6);

  // --- the short list of what the rules say
  const steps: string[] = [phaseLine, valLine, allocLine];
  const due = tranches.filter((t) => t.due && t.amount > 0);
  const next = tranches.find((t) => !t.due && t.amount > 0);
  if (room > 0) {
    if (due.length) steps.push(`Due now: ${rs(due.reduce((s, t) => s + t.amount, 0))}`);
    if (next) steps.push(`Next: ${rs(next.amount)} at KSE-100 ${zoneRange(next)}`);
  }
  if (parkLine) steps.push(parkLine);
  if (addNames.length) steps.push(`Buy: ${addNames.map((n) => n.symbol).join(", ")}`);
  if (reconsider.length) steps.push(`Reconsider: ${reconsider.map((n) => n.symbol).join(", ")}`);
  if (change != null && change !== 0) steps.push(trendLine);

  return {
    phase: { key: phaseKey, drawdownPct: dd, belowMa200, line: phaseLine },
    valuation: { earningsYieldPct: ey, capeYieldPct: cy, tbillPct: tbill, premiumPp: premium, realTbillPct: realTbill, verdict, line: valLine },
    allocation: { total, stocksNowPct: stocksNow, stocksTargetPct: target, dryNowPct: 100 - stocksNow, dryTargetPct: 100 - target, room, line: allocLine },
    tranches,
    rateTrend: { changePp: change, line: trendLine },
    parking: { options: opts.sort((a, b) => b.afterTaxPct - a.afterTaxPct), liquid: liquidAmt, locked: lockAmt, line: parkLine },
    quality: { add: addNames, reconsider, income },
    steps,
  };
}
