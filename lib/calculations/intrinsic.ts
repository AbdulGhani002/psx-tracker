// Intrinsic value + buying zones.
//
// Turns the data we already have (EPS, EPS-growth trend, book value, forward
// dividend, the live SBP discount rate, and the stock's own volatility) into a
// SET of independent intrinsic-value estimates, blends them into one number
// with a low/high band, then derives concrete price "zones" — the price below
// which the stock is a buy, scaled by how risky the stock is.
//
// Every input is real (no fabricated values). A method that lacks its inputs is
// marked not-applicable and excluded from the blend, never guessed.

export type IntrinsicInputs = {
  symbol: string;
  price: number;
  eps: number | null; // latest annual EPS
  epsGrowthPct: number | null; // trailing EPS-growth trend (already clamped upstream)
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
  note: string; // one-line plain explanation
};

export type ZoneLabel = "strong buy" | "buy" | "fair" | "expensive" | "unknown";

export type IntrinsicResult = {
  symbol: string;
  price: number;
  basis: "earnings" | "nav";
  methods: ValuationMethod[];
  intrinsic: number | null; // weighted composite
  low: number | null; // most conservative estimate
  high: number | null; // most optimistic estimate
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

// --- the individual methods ------------------------------------------------

// Graham Number: sqrt(22.5 × EPS × BVPS). 22.5 = 15 (fair P/E) × 1.5 (fair P/B).
// A defensive floor for an asset-backed, profitable company.
function grahamNumber(eps: number | null, bvps: number): number | null {
  if (eps == null || eps <= 0 || bvps <= 0) return null;
  return Math.sqrt(22.5 * eps * bvps);
}

// Graham's revised formula: V = EPS × (8.5 + 2g) × 4.4 / Y.
// 8.5 = the P/E of a no-growth company, g = growth %, 4.4 = Graham's baseline
// AAA bond yield, Y = our required return. Caps g so a hot trend can't run away.
function grahamRevised(eps: number | null, growthPct: number, requiredReturnPct: number): number | null {
  if (eps == null || eps <= 0 || requiredReturnPct <= 0) return null;
  const g = clamp(growthPct, 0, 15);
  return (eps * (8.5 + 2 * g) * 4.4) / requiredReturnPct;
}

// Dividend-discount (Gordon growth): V = D1 / (r − g). Only when r safely > g.
function ddm(forwardDps: number, requiredReturnPct: number, dividendGrowthPct: number): number | null {
  const r = requiredReturnPct / 100;
  const g = dividendGrowthPct / 100;
  if (forwardDps <= 0 || r - g <= 0.005) return null;
  return (forwardDps * (1 + g)) / (r - g);
}

// Earnings Power Value (Greenwald): capitalise no-growth earnings, V = EPS / r.
// The conservative "what it's worth if it never grows again" estimate.
function epv(eps: number | null, requiredReturnPct: number): number | null {
  if (eps == null || eps <= 0 || requiredReturnPct <= 0) return null;
  return eps / (requiredReturnPct / 100);
}

// Two-stage DCF on EPS (used as an earnings proxy — PSX's free feed has no
// cash-flow statement). High growth for N years, then a low terminal growth.
function dcf(eps: number | null, growthPct: number, requiredReturnPct: number, years = 5): number | null {
  if (eps == null || eps <= 0 || requiredReturnPct <= 0) return null;
  const r = requiredReturnPct / 100;
  const g1 = clamp(growthPct, 0, 20) / 100;
  const gT = Math.min(g1, 0.04); // terminal growth ≤ 4%
  if (r - gT <= 0.005) return null;
  let pv = 0;
  let e = eps;
  for (let t = 1; t <= years; t++) {
    e = e * (1 + g1);
    pv += e / Math.pow(1 + r, t);
  }
  const terminalEps = e * (1 + gT);
  const terminalValue = terminalEps / (r - gT);
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
} {
  const r = i.sbpRatePct + i.equityRiskPremiumPct; // required return = risk-free + equity premium
  const g = i.epsGrowthPct ?? 0;

  // Holding companies: NAV dominates; P/E-style methods are reference only.
  const isHoldco = i.navPerShare != null && i.navPerShare > 0;

  const methods: ValuationMethod[] = [
    {
      key: "nav",
      label: "Look-through NAV",
      value: i.navPerShare,
      weight: isHoldco ? 1 : 0,
      note: "Live sum-of-the-parts value of the companies it owns, per share.",
    },
    {
      key: "dcf",
      label: "Discounted earnings (DCF)",
      value: dcf(i.eps, g, r),
      weight: isHoldco ? 0 : 1.3,
      note: "5 years of EPS growth + a terminal value, discounted at your required return.",
    },
    {
      key: "ddm",
      label: "Dividend discount",
      value: ddm(i.forwardDps, r, i.dividendGrowthPct),
      weight: isHoldco ? 0 : 1.2,
      note: "Forward dividend grown forever, discounted (Gordon model).",
    },
    {
      key: "grahamRevised",
      label: "Graham (growth)",
      value: grahamRevised(i.eps, g, r),
      weight: isHoldco ? 0 : 1.0,
      note: "Graham's growth formula: EPS × (8.5 + 2g) × 4.4 / required return.",
    },
    {
      key: "graham",
      label: "Graham number",
      value: grahamNumber(i.eps, i.bvps),
      weight: isHoldco ? 0 : 1.0,
      note: "Defensive floor: √(22.5 × EPS × book value). Needs a book value.",
    },
    {
      key: "epv",
      label: "Earnings power (no growth)",
      value: epv(i.eps, r),
      weight: isHoldco ? 0 : 1.0,
      note: "Worth if earnings never grow again: EPS ÷ required return.",
    },
    {
      key: "earnings",
      label: "Fair P/E × EPS",
      value: earningsMultiple(i.eps, i.fairPE),
      weight: isHoldco ? 0 : 0.8,
      note: `A fair multiple (${i.fairPE}×) on current earnings.`,
    },
  ];

  const weighted = methods.filter((m) => m.value != null && m.value > 0 && m.weight > 0);
  const wSum = weighted.reduce((s, m) => s + m.weight, 0);
  const intrinsic = wSum > 0 ? weighted.reduce((s, m) => s + m.weight * (m.value as number), 0) / wSum : null;

  const vals = weighted.map((m) => m.value as number);
  const low = vals.length ? Math.min(...vals) : null;
  const high = vals.length ? Math.max(...vals) : null;

  return { methods, intrinsic, low, high };
}

// The margin of safety we DEMAND before calling a price a buy — bigger for
// riskier stocks (high volatility) and for companies paying dividends they
// can't cover from earnings.
export function requiredMarginOfSafety(annualVolPct: number | null, aboveEarnings: boolean, epsPositive: boolean): number {
  let mos = 20; // base discount we want on a normal stock
  if (annualVolPct != null) mos += Math.max(0, annualVolPct - 25) * 0.5; // +0.5pp per vol point over 25%
  if (aboveEarnings) mos += 5; // dividend paid from reserves → less safe
  if (!epsPositive) mos += 5; // loss-making → demand more
  return clamp(mos, 15, 45);
}

export function computeIntrinsic(i: IntrinsicInputs): IntrinsicResult {
  const { methods, intrinsic, low, high } = compositeIntrinsic(i);
  const basis: "earnings" | "nav" = i.navPerShare != null && i.navPerShare > 0 ? "nav" : "earnings";
  const r = i.sbpRatePct + i.equityRiskPremiumPct; // required return = risk-free + equity premium
  const g = i.epsGrowthPct ?? 0;

  const epsPositive = i.eps != null && i.eps > 0;
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
    strongBuyBelow = intrinsic * (1 - requiredMosPct / 100 - 0.1); // extra 10% cushion
    fairUpTo = intrinsic * 1.05; // within 5% above intrinsic still "fair"

    if (i.price <= strongBuyBelow) zone = "strong buy";
    else if (i.price <= buyBelow) zone = "buy";
    else if (i.price <= fairUpTo) zone = "fair";
    else zone = "expensive";

    // 0 = price is half of intrinsic, 50 = price equals intrinsic, 100 = double.
    pricePositionPct = clamp((i.price / intrinsic) * 50, 0, 100);
  }

  // Confidence: how many methods agree, and how tightly.
  const vals = methods.filter((m) => m.value != null && m.value > 0 && m.weight > 0).map((m) => m.value as number);
  let confidence: IntrinsicResult["confidence"] = "low";
  if (vals.length >= 2 && intrinsic) {
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
    const cv = mean > 0 ? sd / mean : 1; // coefficient of variation
    if (basis === "nav") confidence = "medium";
    else if (vals.length >= 4 && cv < 0.3) confidence = "high";
    else if (vals.length >= 3 && cv < 0.5) confidence = "medium";
    else confidence = "low";
  }

  // The "why".
  const drivers: string[] = [];
  drivers.push(`Required return ${r.toFixed(1)}% = SBP ${i.sbpRatePct.toFixed(1)}% + ${i.equityRiskPremiumPct.toFixed(0)}% equity premium.`);
  if (basis === "nav") {
    drivers.push("Valued on look-through NAV — its earnings are mostly revaluation of the shares it owns, so P/E is misleading.");
  } else {
    drivers.push(`Growth ${clamp(g, 0, 20).toFixed(1)}% from the EPS trend feeds the DCF and Graham-growth models.`);
  }
  if (intrinsic != null && buyBelow != null) {
    drivers.push(
      `We demand a ${requiredMosPct.toFixed(0)}% margin of safety${
        i.annualVolPct != null ? ` (this stock's ${i.annualVolPct.toFixed(0)}% volatility ${i.annualVolPct > 25 ? "widens" : "keeps"} it)` : ""
      } — so the buy line sits at Rs ${buyBelow.toFixed(2)}, below the Rs ${intrinsic.toFixed(2)} intrinsic value.`
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

  const out: Sensitivity[] = [
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
      // higher discount rate LOWERS value, so low/high are swapped on purpose.
      // required return = SBP + equity premium, so we move the premium.
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
  return out;
}
