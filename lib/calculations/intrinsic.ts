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

export type IntrinsicInputs = {
  symbol: string;
  price: number;
  eps: number | null; // latest annual EPS (for the displayed P/E)
  normalizedEps?: number | null; // through-cycle EPS (avg of last 3 yrs) — the earning power used by the models
  epsGrowthPct: number | null; // multi-year EPS growth (CAGR), not one freak year
  bvps: number; // book value per share, 0 = unknown
  forwardDps: number; // forward annual dividend (from the forecast)
  dividendGrowthPct: number; // expected dividend growth %
  sbpRatePct: number; // live SBP policy rate (risk-free)
  equityRiskPremiumPct: number; // your equity premium
  fairPE: number; // assumed fair P/E
  aboveEarnings: boolean; // dividend is paid from reserves (exceeds EPS)
  annualVolPct: number | null; // the stock's own annualised volatility (risk)
  navPerShare: number | null; // look-through NAV/share for holding companies
};

export type MethodKey = "nav" | "graham" | "grahamRevised" | "ddm" | "epv" | "dcf" | "earnings";

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

// Through-cycle earning power: the average of the last 3 positive annual EPS,
// so one spike or dip doesn't define the value. Falls back to whatever exists.
export function normalizedEps(epsAsc: number[]): number | null {
  const xs = epsAsc.filter((e) => Number.isFinite(e) && e > 0);
  if (!xs.length) return null;
  const last3 = xs.slice(-3);
  return last3.reduce((s, e) => s + e, 0) / last3.length;
}

// Multi-year EPS growth (CAGR across all available years), not a single freak
// year. Clamped to a sane band so a recovery year can't imply 90% forever.
export function robustGrowthPct(epsAsc: number[]): number {
  const xs = epsAsc.filter((e) => Number.isFinite(e) && e > 0);
  if (xs.length < 2) return 0;
  const first = xs[0];
  const last = xs[xs.length - 1];
  const years = xs.length - 1;
  const cagr = (Math.pow(last / first, 1 / years) - 1) * 100;
  return clamp(cagr, -10, 25);
}

// --- the individual methods ------------------------------------------------

// Graham Number: sqrt(22.5 × EPS × BVPS). 22.5 = 15 (fair P/E) × 1.5 (fair P/B).
function grahamNumber(eps: number | null, bvps: number): number | null {
  if (eps == null || eps <= 0 || bvps <= 0) return null;
  return Math.sqrt(22.5 * eps * bvps);
}

// Graham's revised formula: V = EPS × (8.5 + 2g) × 4.4 / Y.
function grahamRevised(eps: number | null, growthPct: number, requiredReturnPct: number): number | null {
  if (eps == null || eps <= 0 || requiredReturnPct <= 0) return null;
  const g = clamp(growthPct, 0, 15);
  return (eps * (8.5 + 2 * g) * 4.4) / requiredReturnPct;
}

// Dividend-discount (Gordon growth): V = D1 / (r − g).
function ddm(forwardDps: number, requiredReturnPct: number, dividendGrowthPct: number): number | null {
  const r = requiredReturnPct / 100;
  const g = dividendGrowthPct / 100;
  if (forwardDps <= 0 || r - g <= 0.005) return null;
  return (forwardDps * (1 + g)) / (r - g);
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

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Pure composite so sensitivity can re-run it with tweaked inputs.
export function compositeIntrinsic(i: IntrinsicInputs): {
  methods: ValuationMethod[];
  intrinsic: number | null;
  low: number | null;
  high: number | null;
  excluded: MethodKey[];
} {
  const r = i.sbpRatePct + i.equityRiskPremiumPct; // required return = risk-free + equity premium
  const g = i.epsGrowthPct ?? 0;
  const e = i.normalizedEps ?? i.eps; // earning power the models run on

  const isHoldco = i.navPerShare != null && i.navPerShare > 0;

  const methods: ValuationMethod[] = [
    { key: "nav", label: "Look-through NAV", value: i.navPerShare, weight: isHoldco ? 1 : 0, included: false, note: "Live sum-of-the-parts value of the companies it owns, per share." },
    { key: "dcf", label: "Discounted earnings (DCF)", value: dcf(e, g, r), weight: isHoldco ? 0 : 1.3, included: false, note: "5 years of earnings growth + a terminal value, discounted at your required return." },
    { key: "epv", label: "Earnings power (no growth)", value: epv(e, r), weight: isHoldco ? 0 : 1.1, included: false, note: "Worth if earnings never grow again: normalised EPS ÷ required return." },
    { key: "earnings", label: "Fair P/E × EPS", value: earningsMultiple(e, i.fairPE), weight: isHoldco ? 0 : 1.0, included: false, note: `A fair multiple (${i.fairPE}×) on normalised earnings.` },
    { key: "grahamRevised", label: "Graham (growth)", value: grahamRevised(e, g, r), weight: isHoldco ? 0 : 1.0, included: false, note: "Graham's growth formula: EPS × (8.5 + 2g) × 4.4 / required return." },
    { key: "graham", label: "Graham number", value: grahamNumber(e, i.bvps), weight: isHoldco ? 0 : 1.0, included: false, note: "Defensive floor: √(22.5 × EPS × book value). Needs a book value." },
    { key: "ddm", label: "Dividend discount", value: ddm(i.forwardDps, r, i.dividendGrowthPct), weight: isHoldco ? 0 : 0.7, included: false, note: "Forward dividend grown forever, discounted (Gordon model). Sensitive — down-weighted." },
  ];

  const applicable = methods.filter((m) => m.value != null && m.value > 0 && m.weight > 0);

  // Outlier rejection: when 4+ methods agree, drop any that sit more than 50%
  // away from the median of the group — that's how a single broken model (a
  // mis-estimated dividend, say) is stopped from dragging the blend off.
  let usable = applicable;
  const excluded: MethodKey[] = [];
  if (applicable.length >= 4) {
    const med = median(applicable.map((m) => m.value as number));
    const trimmed = applicable.filter((m) => Math.abs((m.value as number) - med) / med <= 0.5);
    if (trimmed.length >= 2) {
      usable = trimmed;
      for (const m of applicable) if (!trimmed.includes(m)) excluded.push(m.key);
    }
  }

  const usableSet = new Set(usable);
  for (const m of methods) m.included = usableSet.has(m);

  const wSum = usable.reduce((s, m) => s + m.weight, 0);
  const intrinsic = wSum > 0 ? usable.reduce((s, m) => s + m.weight * (m.value as number), 0) / wSum : null;
  const vals = usable.map((m) => m.value as number);
  const low = vals.length ? Math.min(...vals) : null;
  const high = vals.length ? Math.max(...vals) : null;

  return { methods, intrinsic, low, high, excluded };
}

// The margin of safety we DEMAND before calling a price a buy — bigger for
// riskier stocks (high volatility) and for companies paying dividends they
// can't cover from earnings.
export function requiredMarginOfSafety(annualVolPct: number | null, aboveEarnings: boolean, epsPositive: boolean): number {
  let mos = 20;
  if (annualVolPct != null) mos += Math.max(0, annualVolPct - 25) * 0.5;
  if (aboveEarnings) mos += 5;
  if (!epsPositive) mos += 5;
  return clamp(mos, 15, 45);
}

export function computeIntrinsic(i: IntrinsicInputs): IntrinsicResult {
  const { methods, intrinsic, low, high, excluded } = compositeIntrinsic(i);
  const basis: "earnings" | "nav" = i.navPerShare != null && i.navPerShare > 0 ? "nav" : "earnings";
  const r = i.sbpRatePct + i.equityRiskPremiumPct;
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
    strongBuyBelow = intrinsic * (1 - requiredMosPct / 100 - 0.1);
    fairUpTo = intrinsic * 1.05;

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

  const drivers: string[] = [];
  drivers.push(`Required return ${r.toFixed(1)}% = SBP ${i.sbpRatePct.toFixed(1)}% + ${i.equityRiskPremiumPct.toFixed(0)}% equity premium. A higher rate lowers every value.`);
  if (basis === "nav") {
    drivers.push("Valued on look-through NAV — its earnings are mostly revaluation of the shares it owns, so P/E is misleading.");
  } else {
    drivers.push(`Through-cycle growth ${clamp(g, -10, 25).toFixed(1)}%/yr (a multi-year EPS trend, not one freak year) feeds the DCF and Graham models.`);
    drivers.push(`Blended from ${incl.length} of the methods below; the value is the weighted middle of those that agree.`);
  }
  if (excluded.length) {
    const names = excluded.map((k) => methods.find((m) => m.key === k)?.label ?? k).join(", ");
    drivers.push(`Set aside as an outlier (more than 50% from the others): ${names}.`);
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
      low: at({ epsGrowthPct: g - 3, dividendGrowthPct: i.dividendGrowthPct - 3 }),
      high: at({ epsGrowthPct: g + 3, dividendGrowthPct: i.dividendGrowthPct + 3 }),
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
