// Intrinsic value + buying zones.
//
// Turns the data we already have (EPS history, book value, forward dividend, the
// live SBP discount rate, and the stock's own volatility) into a SET of
// independent intrinsic-value estimates, blends them ROBUSTLY (a broken method
// can't sink the result), and derives concrete price "zones" — the price below
// which the stock is a buy, scaled by how risky the stock is.
//
// Every input is real (no fabricated values). A method that lacks its inputs is
// marked not-applicable and excluded from the blend, never guessed. Earnings are
// NORMALISED through the cycle and growth is a multi-year trend, so one freak
// year can't distort the value.

import { disclosedValue, type DisclosedModel } from "./gordon";
import { requiredReturn, explainRequiredReturn, type RequiredReturn } from "./capm";

export type IntrinsicInputs = {
  symbol: string;
  price: number;
  eps: number | null; // latest annual EPS (for the displayed P/E)
  normalizedEps?: number | null; // through-cycle EPS (avg of last 3 yrs) — the earning power used by the models
  epsGrowthPct: number | null; // multi-year EPS growth (CAGR), not one freak year
  forwardDps: number; // forward annual dividend (from the forecast)
  dividendGrowthPct: number; // expected dividend growth %
  sbpRatePct: number; // live SBP policy rate (risk-free)
  equityRiskPremiumPct: number; // your equity premium
  fairPE: number; // assumed fair P/E
  aboveEarnings: boolean; // dividend is paid from reserves (exceeds EPS)
  annualVolPct: number | null; // the stock's own annualised volatility (risk)
  navPerShare: number | null; // look-through NAV/share for holding companies
  disclosed?: DisclosedModel | null; // the company's own audited fair-value model, if it publishes one
  betaRaw?: number | null; // this share's OWN beta vs KSE-100 (measured). null = use market risk.
  sector?: string; // PSX sector — drives the sector-appropriate fair P/E
  netMarginPct?: number | null; // latest net profit margin (quality signal, display)
  marginTrendPct?: number | null; // change in net margin vs prior year (pp)
  revenueGrowthPct?: number | null; // top-line growth (display)
  peTtm?: number | null; // PSX's reported trailing P/E (display / cross-check)
};

export type MethodKey = "nav" | "ddm" | "epv" | "dcf" | "earnings" | "disclosed";

export type ValuationMethod = {
  key: MethodKey;
  label: string;
  value: number | null; // intrinsic per share (null = not applicable)
  weight: number; // blend weight (0 = reference only)
  included: boolean; // did it make it into the blend (false = N/A or rejected as an outlier)
  note: string; // one-line plain explanation
};

export type ZoneLabel = "strong buy" | "buy" | "fair" | "expensive" | "unknown";

export type IntrinsicResult = {
  symbol: string;
  price: number;
  basis: "earnings" | "nav";
  methods: ValuationMethod[];
  intrinsic: number | null; // robust weighted composite
  low: number | null; // most conservative included estimate
  high: number | null; // most optimistic included estimate
  marginOfSafetyPct: number | null; // (intrinsic − price) / intrinsic
  requiredReturnPct: number; // r = SBP + equity premium
  growthPct: number; // g used in the growth models
  requiredMosPct: number; // margin of safety we demand (risk-scaled)
  strongBuyBelow: number | null;
  buyBelow: number | null;
  fairUpTo: number | null;
  zone: ZoneLabel;
  pricePositionPct: number | null; // 0 = deep value, 50 = fair, 100 = expensive
  confidence: "high" | "medium" | "low";
  drivers: string[]; // the "why", in words
};

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

// --- normalisation helpers (take EPS in ascending year order) ---------------

// Through-cycle earning power: the average of the last 3 REPORTED annual EPS —
// including loss years. Filtering losses out (the old behaviour) produced a
// "through-cycle" figure that excluded the cycle: a company earning 5, -4, 6
// was credited with 5.5 of earning power it plainly doesn't have. If the
// 3-year average itself is not positive there is no earning power to price —
// return null and let the earnings-based models sit out honestly.
export function normalizedEps(epsAsc: number[]): number | null {
  const xs = epsAsc.filter((e) => Number.isFinite(e));
  if (!xs.length) return null;
  const last3 = xs.slice(-3);
  const avg = last3.reduce((s, e) => s + e, 0) / last3.length;
  return avg > 0 ? avg : null;
}

// Multi-year EPS growth (CAGR across all available years), not a single freak
// year. Clamped to a sane band so a recovery year can't imply 90% forever.
//
// The span must be measured on the ORIGINAL timeline. Loss years are skipped as
// endpoints (you can't take a root of a negative), but they still consumed real
// calendar time: dropping them from the year count compresses the span and
// inflates the CAGR. e.g. [5,-2,-3,8,9,10] is 5 years of elapsed time, not 3 —
// counting survivors gave 25%/yr when the truth is 14.87%/yr, which then
// inflated fair P/E and DCF and manufactured "buy" zones.
export function robustGrowthPct(epsAsc: number[]): number {
  const points = epsAsc
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => Number.isFinite(e) && e > 0);
  if (points.length < 2) return 0;
  const first = points[0];
  const last = points[points.length - 1];
  const years = last.i - first.i; // elapsed span on the real timeline
  if (years <= 0) return 0;
  const cagr = (Math.pow(last.e / first.e, 1 / years) - 1) * 100;
  return clamp(cagr, -10, 25);
}

// --- the individual methods ------------------------------------------------

// Dividend-discount (Gordon growth): V = D1 / (r − g). Growth is capped low —
// the model explodes as g approaches r, so we keep a safe gap.
function ddm(forwardDps: number, requiredReturnPct: number, dividendGrowthPct: number): number | null {
  const r = requiredReturnPct / 100;
  const g = clamp(dividendGrowthPct, -5, 6) / 100;
  if (forwardDps <= 0 || r - g <= 0.04) return null;
  return (forwardDps * (1 + g)) / (r - g);
}

// Realistic mid-cycle P/E by PSX sector — how the Pakistani market ACTUALLY
// prices each business. A bank, a power utility and a brewery monopoly do not
// deserve the same multiple, and pretending they do was the model's core flaw.
// Matched on keywords against the PSX sector name (loosely, newest patterns
// first wins). Ranges reflect long-run PSX sector multiples.
const SECTOR_PE: Array<[RegExp, number]> = [
  [/food|personal care|beverage|tobacco/i, 15], // defensive monopolies trade at a big premium (MUREB, Nestlé)
  [/pharma/i, 14],
  [/technolog|software|communication/i, 12],
  [/glass|ceramic/i, 9],
  [/chemical/i, 9],
  [/cement/i, 8], // cyclical
  [/fertiliz/i, 8],
  [/automobile/i, 8],
  [/insurance/i, 8],
  [/bank|commercial bank/i, 7], // PK banks trade cheap despite high ROE
  [/engineer/i, 7],
  [/paper|board/i, 7],
  [/oil & gas market|marketing/i, 7],
  [/exploration|e&p/i, 6], // circular-debt discount (PPL, OGDC)
  [/invest|securit|brokerage|modaraba|leasing/i, 6], // book-value driven
  [/sugar/i, 6],
  [/refinery|textile/i, 5],
  [/power|electric/i, 5], // regulated returns + circular debt — low multiple, dividend plays
];
const DEFAULT_SECTOR_PE = 8;

export function sectorBasePE(sector: string): number {
  for (const [re, pe] of SECTOR_PE) if (re.test(sector)) return pe;
  return DEFAULT_SECTOR_PE;
}

// The fair P/E a stock actually deserves: its SECTOR's mid-cycle multiple,
// lifted by growth and a strong/rising net margin, compressed when the SBP rate
// is high (and lifted when it cuts). Bounded to a wide PK band so a defensive
// monopoly can reach the high teens while a power utility sits near 5×.
export function sectorFairPE(sector: string, growthPct: number, sbpRatePct: number, marginTrendPct = 0): number {
  let pe = sectorBasePE(sector);
  pe += clamp(growthPct, -5, 18) * 0.15; // growth premium (sector base does most of the work)
  pe += clamp(marginTrendPct, -5, 5) * 0.2; // rising margins earn a premium, falling ones a discount
  pe -= Math.max(0, sbpRatePct - 11) * 0.25; // high rates compress multiples
  pe += Math.max(0, 11 - sbpRatePct) * 0.2; // rate cuts lift them
  return clamp(pe, 3.5, 22);
}

// Back-compat: a sector-less fair P/E (used where the sector is unknown).
export function pkFairPE(growthPct: number, sbpRatePct: number): number {
  return sectorFairPE("", growthPct, sbpRatePct);
}

// Earnings Power Value (Greenwald): V = EPS / r. Conservative, no growth.
function epv(eps: number | null, requiredReturnPct: number): number | null {
  if (eps == null || eps <= 0 || requiredReturnPct <= 0) return null;
  return eps / (requiredReturnPct / 100);
}

// Two-stage DCF on normalised EPS (earnings proxy — PSX's free feed has no
// cash-flow statement). High growth for N years, then a low terminal growth.
function dcf(eps: number | null, growthPct: number, requiredReturnPct: number, years = 5): number | null {
  if (eps == null || eps <= 0 || requiredReturnPct <= 0) return null;
  const r = requiredReturnPct / 100;
  const g1 = clamp(growthPct, 0, 20) / 100;
  const gT = Math.min(g1, 0.04);
  if (r - gT <= 0.005) return null;
  let pv = 0;
  let e = eps;
  for (let t = 1; t <= years; t++) {
    e = e * (1 + g1);
    pv += e / Math.pow(1 + r, t);
  }
  const terminalValue = (e * (1 + gT)) / (r - gT);
  pv += terminalValue / Math.pow(1 + r, years);
  return pv;
}

function earningsMultiple(eps: number | null, fairPE: number): number | null {
  if (eps == null || eps <= 0 || fairPE <= 0) return null;
  return eps * fairPE;
}

// --- compose all methods into one intrinsic value --------------------------

// Pure composite so sensitivity can re-run it with tweaked inputs.
export function compositeIntrinsic(i: IntrinsicInputs): {
  methods: ValuationMethod[];
  intrinsic: number | null;
  low: number | null;
  high: number | null;
  excluded: MethodKey[];
} {
  // Required return is now PER-COMPANY: risk-free + (this share's own adjusted
  // beta) x your equity premium. A defensive utility and a volatile cyclical no
  // longer clear the same hurdle. No beta measured -> beta 1, i.e. exactly the
  // old flat risk-free + premium. See lib/calculations/capm.ts.
  const rr = requiredReturn({ riskFreePct: i.sbpRatePct, erpPct: i.equityRiskPremiumPct, betaRaw: i.betaRaw ?? null });
  const r = rr.requiredReturnPct;
  const g = i.epsGrowthPct ?? 0;
  const e = i.normalizedEps ?? i.eps; // earning power the models run on

  const isHoldco = i.navPerShare != null && i.navPerShare > 0;

  // Pakistan-tuned method mix. The LEAD is a realistic fair P/E (a blue-chip
  // multiple lifted by growth, set on the page via pkFairPE) × normalised EPS —
  // the read that matches how PK equities actually price. The no-growth EPS÷rate
  // is kept only as a low-weight downside floor, because on its own it marks
  // every PK stock "expensive".
  // A holding company that reliably hands cash up is ALSO an income stream. NAV
  // says what it owns; the dividend says what it actually pays you — and the
  // market prices holdcos at a discount to NAV precisely because you only ever
  // receive the dividends. Zeroing the DDM for every holdco threw that read away.
  const paysDividend = i.forwardDps > 0;
  const ddmWeight = isHoldco ? (paysDividend ? 1.0 : 0) : 0.5;

  const disclosedCell = disclosedValue(i.disclosed);

  const methods: ValuationMethod[] = [
    // The company's own audited assumptions beat ours. Weighted highest when present.
    {
      key: "disclosed",
      label: "Company's own model (audited)",
      value: disclosedCell?.value ?? null,
      weight: 1.5,
      included: false,
      note: i.disclosed
        ? `The company's disclosed fair value: Gordon growth at r=${i.disclosed.requiredReturnPct}%, g=${i.disclosed.growthPct}% on a Rs ${i.disclosed.baseDps} dividend. Source: ${i.disclosed.source}`
        : "The company publishes no fair-value assumptions we've recorded.",
    },
    { key: "nav", label: "Look-through NAV", value: i.navPerShare, weight: isHoldco ? 1 : 0, included: false, note: "Live sum-of-the-parts value of the companies it owns, per share." },
    { key: "earnings", label: "Fair P/E × EPS", value: earningsMultiple(e, i.fairPE), weight: isHoldco ? 0 : 3.0, included: false, note: `A realistic Pakistani fair multiple (${i.fairPE.toFixed(1)}×, from growth + the SBP rate) on normalised earnings.` },
    { key: "dcf", label: "Discounted earnings (DCF)", value: dcf(e, g, r), weight: isHoldco ? 0 : 0.8, included: false, note: "5 years of (faded) earnings growth + a terminal value, discounted at your required return." },
    { key: "ddm", label: "Dividend discount", value: ddm(i.forwardDps, r, i.dividendGrowthPct), weight: ddmWeight, included: false, note: `Valued as a pure income stream: the dividend grown forever and discounted at r = ${r.toFixed(1)}% (risk-free ${i.sbpRatePct}% + ${i.equityRiskPremiumPct}pp equity premium). Gordon: D₀(1+g)/(r−g).` },
    // Weight 0 on purpose: EPS ÷ r at a ~16-21% required return prices zero
    // growth forever — a stress floor, not a fair value. It is SHOWN as context
    // but no longer mixed into the blend, where it dragged every stock down.
    { key: "epv", label: "Worst-case floor (zero growth, reference only)", value: epv(e, r), weight: 0, included: false, note: "Normalised EPS ÷ required return with zero growth forever — the price at which the stock works even if it never grows again. Context, not fair value." },
  ];

  const applicable = methods.filter((m) => m.value != null && m.value > 0 && m.weight > 0);

  // Anchor on the LEAD method (the realistic fair-P/E read, or NAV for a holding
  // company — the highest-weight applicable one), then WINSORISE: a method that
  // disagrees with the anchor by more than 50% still contributes, but capped to
  // the ±50% band. This stops a broken model (a mis-estimated dividend) or an
  // over-conservative floor from hijacking the value, WITHOUT ever dropping a
  // method — so the blend is stable and moves smoothly as inputs change (hard
  // exclusion flipped membership and made the value jump around).
  const excluded: MethodKey[] = [];
  let intrinsic: number | null = null;
  let low: number | null = null;
  let high: number | null = null;

  if (applicable.length) {
    const anchor = [...applicable].sort((a, b) => b.weight - a.weight)[0];
    const av = anchor.value as number;
    const loB = av * 0.5;
    const hiB = av * 1.5;
    const contributions: number[] = [];
    let wSum = 0;
    let acc = 0;
    for (const m of methods) {
      if (m.value == null || m.value <= 0 || m.weight <= 0) {
        m.included = false;
        continue;
      }
      const v = m.value as number;
      const clipped = Math.max(loB, Math.min(hiB, v));
      const isOutlier = applicable.length >= 3 && (v < loB || v > hiB);
      m.included = !isOutlier;
      if (isOutlier) excluded.push(m.key);
      acc += m.weight * clipped;
      wSum += m.weight;
      contributions.push(clipped);
    }
    intrinsic = wSum > 0 ? acc / wSum : null;
    low = contributions.length ? Math.min(...contributions) : null;
    high = contributions.length ? Math.max(...contributions) : null;
  }

  return { methods, intrinsic, low, high, excluded };
}

// The margin of safety we DEMAND before calling a price a buy — bigger for
// riskier stocks (high volatility) and for companies paying dividends they
// can't cover from earnings.
export function requiredMarginOfSafety(annualVolPct: number | null, aboveEarnings: boolean, epsPositive: boolean): number {
  // PK equities are volatile, so demanding a 20%+ discount on everything means
  // you never buy. A ~12% base (a normal dip) on a steady blue chip, widening
  // only for genuinely jumpy or loss-making names, keeps the buy line reachable.
  let mos = 12;
  if (annualVolPct != null) mos += Math.max(0, annualVolPct - 30) * 0.4;
  if (aboveEarnings) mos += 4;
  if (!epsPositive) mos += 5;
  return clamp(mos, 10, 35);
}

export function computeIntrinsic(i: IntrinsicInputs): IntrinsicResult {
  const { methods, intrinsic, low, high, excluded } = compositeIntrinsic(i);
  const basis: "earnings" | "nav" = i.navPerShare != null && i.navPerShare > 0 ? "nav" : "earnings";
  // Must match what compositeIntrinsic actually discounted with — this used to
  // recompute the flat "SBP + premium" on its own, so the rate REPORTED to the
  // user could differ from the rate the models USED once beta entered the picture.
  const rr = requiredReturn({ riskFreePct: i.sbpRatePct, erpPct: i.equityRiskPremiumPct, betaRaw: i.betaRaw ?? null });
  const r = rr.requiredReturnPct;
  const g = i.epsGrowthPct ?? 0;

  const epsPositive = (i.normalizedEps ?? i.eps ?? 0) > 0;
  const requiredMosPct = requiredMarginOfSafety(i.annualVolPct, i.aboveEarnings, epsPositive);

  let marginOfSafetyPct: number | null = null;
  let strongBuyBelow: number | null = null;
  let buyBelow: number | null = null;
  let fairUpTo: number | null = null;
  let zone: ZoneLabel = "unknown";
  let pricePositionPct: number | null = null;

  if (intrinsic != null && intrinsic > 0 && i.price > 0) {
    marginOfSafetyPct = ((intrinsic - i.price) / intrinsic) * 100;
    buyBelow = intrinsic * (1 - requiredMosPct / 100);
    strongBuyBelow = intrinsic * (1 - requiredMosPct / 100 - 0.08);
    fairUpTo = intrinsic * 1.15; // valuation is uncertain — within ~15% of fair value still reads "fair", not "expensive"

    if (i.price <= strongBuyBelow) zone = "strong buy";
    else if (i.price <= buyBelow) zone = "buy";
    else if (i.price <= fairUpTo) zone = "fair";
    else zone = "expensive";

    pricePositionPct = clamp((i.price / intrinsic) * 50, 0, 100);
  }

  // Confidence: how many INCLUDED methods agree, and how tightly.
  const incl = methods.filter((m) => m.included).map((m) => m.value as number);
  let confidence: IntrinsicResult["confidence"] = "low";
  if (incl.length >= 2 && intrinsic) {
    const mean = incl.reduce((s, v) => s + v, 0) / incl.length;
    const sd = Math.sqrt(incl.reduce((s, v) => s + (v - mean) ** 2, 0) / incl.length);
    const cv = mean > 0 ? sd / mean : 1;
    if (basis === "nav") confidence = "medium";
    else if (incl.length >= 4 && cv < 0.3) confidence = "high";
    else if (incl.length >= 3 && cv < 0.5) confidence = "medium";
    else confidence = "low";
  }

  const e = i.normalizedEps ?? i.eps;
  const earningsYieldPct = e != null && e > 0 && i.price > 0 ? (e / i.price) * 100 : null;
  const drivers: string[] = [];
  // Describe the rate we ACTUALLY used. The old line hardcoded "SBP + premium"
  // and rounded the premium to a whole number, so it printed "11.5% + 6%" for a
  // 17.0% rate built from 5.5% and a beta — an explanation that didn't add up.
  drivers.push(explainRequiredReturn(rr) + " A higher rate lowers every value.");
  if (basis === "nav") {
    drivers.push("Valued on look-through NAV — its earnings are mostly revaluation of the shares it owns, so P/E is misleading.");
  } else {
    const sec = (i.sector ?? "").trim();
    drivers.push(
      `Valued like a ${sec ? sec.toLowerCase() : "Pakistani"} business: the lead is its SECTOR's fair P/E of ${i.fairPE.toFixed(1)}× — ${
        i.fairPE >= 12 ? "a defensive premium" : i.fairPE <= 6 ? "a low multiple (circular debt / regulated returns)" : "a typical mid-cycle multiple"
      } — on through-cycle earnings, not a one-size-fits-all number.`
    );
    drivers.push(`Through-cycle growth ${clamp(g, -10, 25).toFixed(1)}%/yr (a faded multi-year EPS trend, not one freak year) and the discounted-earnings + dividend models cross-check it.`);
    if (i.netMarginPct != null) {
      drivers.push(
        `Net profit margin ${i.netMarginPct.toFixed(1)}%${
          i.marginTrendPct != null ? ` (${i.marginTrendPct >= 0 ? "+" : ""}${i.marginTrendPct.toFixed(1)}pp vs last year — ${i.marginTrendPct >= 0 ? "improving, earns a premium" : "slipping, a discount"})` : ""
        }${i.revenueGrowthPct != null ? `; revenue ${i.revenueGrowthPct >= 0 ? "+" : ""}${i.revenueGrowthPct.toFixed(0)}% YoY` : ""}.`
      );
    }
    if (i.peTtm != null) {
      drivers.push(`Trades on a trailing P/E of ${i.peTtm.toFixed(1)}× (PSX) vs the ${i.fairPE.toFixed(1)}× we think the sector deserves — ${i.peTtm <= i.fairPE ? "cheaper than fair" : "richer than fair"}.`);
    }
    if (earningsYieldPct != null) {
      const spread = earningsYieldPct - i.sbpRatePct;
      drivers.push(
        `Earnings yield ${earningsYieldPct.toFixed(1)}% vs the ${i.sbpRatePct.toFixed(1)}% risk-free rate — a ${spread >= 0 ? "+" : ""}${spread.toFixed(1)}pp spread. ${
          spread >= 2 ? "Earnings comfortably beat T-bills." : spread >= 0 ? "Barely above T-bills — thin compensation for equity risk." : "Below T-bills: you'd earn more in a savings account at today's price."
        }`
      );
    }
    drivers.push(`Blended from ${incl.length} of the methods below; the value is the weighted middle of those that agree.`);
  }
  if (excluded.length) {
    const names = excluded.map((k) => methods.find((m) => m.key === k)?.label ?? k).join(", ");
    drivers.push(`Capped as an outlier (more than 50% from the lead estimate, so it can't distort the blend): ${names}.`);
  }
  if (intrinsic != null && buyBelow != null) {
    drivers.push(
      `We demand a ${requiredMosPct.toFixed(0)}% margin of safety${
        i.annualVolPct != null ? ` (this stock's ${i.annualVolPct.toFixed(0)}% volatility ${i.annualVolPct > 25 ? "widens" : "keeps"} it)` : ""
      }, so the buy line is Rs ${buyBelow.toFixed(2)} — below the Rs ${intrinsic.toFixed(2)} intrinsic value.`
    );
  }
  if (i.aboveEarnings) drivers.push("Its dividend currently exceeds earnings (paid from reserves) — we add 5% to the safety margin.");
  if (!epsPositive && basis !== "nav") drivers.push("Loss-making on the latest annual EPS — earnings-based methods are unavailable or cautious.");

  return {
    symbol: i.symbol,
    price: i.price,
    basis,
    methods,
    intrinsic,
    low,
    high,
    marginOfSafetyPct,
    requiredReturnPct: r,
    growthPct: g,
    requiredMosPct,
    strongBuyBelow,
    buyBelow,
    fairUpTo,
    zone,
    pricePositionPct,
    confidence,
    drivers,
  };
}

// --- sensitivity: how the intrinsic value moves when assumptions change -----

export type Sensitivity = { label: string; low: number; base: number; high: number; loLabel: string; hiLabel: string };

export function intrinsicSensitivity(i: IntrinsicInputs): Sensitivity[] {
  const base = compositeIntrinsic(i).intrinsic;
  if (base == null) return [];
  const at = (over: Partial<IntrinsicInputs>) => compositeIntrinsic({ ...i, ...over }).intrinsic ?? base;
  const g = i.epsGrowthPct ?? 0;

  return [
    {
      label: "Growth ±3pp",
      base,
      // growth also lifts the fair P/E (via pkFairPE on the page), so move both
      // together for a realistic swing — clamp keeps it within the model's band.
      low: at({ epsGrowthPct: g - 3, dividendGrowthPct: i.dividendGrowthPct - 3, fairPE: pkFairPE(g - 3, i.sbpRatePct) }),
      high: at({ epsGrowthPct: g + 3, dividendGrowthPct: i.dividendGrowthPct + 3, fairPE: pkFairPE(g + 3, i.sbpRatePct) }),
      loLabel: `${(g - 3).toFixed(0)}%`,
      hiLabel: `${(g + 3).toFixed(0)}%`,
    },
    {
      label: "Required return ±2pp",
      base,
      low: at({ equityRiskPremiumPct: i.equityRiskPremiumPct + 2 }),
      high: at({ equityRiskPremiumPct: i.equityRiskPremiumPct - 2 }),
      loLabel: `${(i.sbpRatePct + i.equityRiskPremiumPct + 2).toFixed(0)}%`,
      hiLabel: `${(i.sbpRatePct + i.equityRiskPremiumPct - 2).toFixed(0)}%`,
    },
    {
      label: "Fair P/E ±2",
      base,
      low: at({ fairPE: Math.max(1, i.fairPE - 2) }),
      high: at({ fairPE: i.fairPE + 2 }),
      loLabel: `${Math.max(1, i.fairPE - 2)}×`,
      hiLabel: `${i.fairPE + 2}×`,
    },
  ];
}
