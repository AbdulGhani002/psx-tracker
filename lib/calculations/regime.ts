// Market regime: are you playing offense or defense?
//
// Fundamentals say WHAT to buy. Price says WHEN. Regime says HOW MUCH, and what
// to leave alone. It is the layer most private investors skip, and it is the one
// that decides whether a good stock picked in a bad month ruins the year.
//
// The method is deliberately dull: score a handful of signals from -2 to +2, add
// them up, and read the total off a table. Dullness is the point. A number you
// can reproduce next month beats a view you cannot.
//
// Most signals the app reads on its own: the index against its own 200-day
// average, oil, the rupee, the policy rate, inflation, NCCPL foreign flows and
// market breadth. Politics it cannot read, because there is no feed for whether
// the IMF programme is on track and a sentiment score scraped off headlines
// would dress a guess up as a reading. So politics is entered by hand, any
// fetched signal can be overruled by hand, and the app says plainly which is
// which — a scorecard that hides its manual inputs is a scorecard that lies
// about how much it knows.
//
// The output is not "buy" or "sell". It is a CASH FLOOR — the minimum share of
// the portfolio that should not be in equities in this environment. That is the
// only lever regime should pull. Which names to own is a different question.
//
// Pure arithmetic. Fetching lives in lib/feeds.

export type SignalSource = "auto" | "manual";

export type RegimeSignal = {
  key: string;
  label: string;
  source: SignalSource;
  score: number; // -2..+2, 0 when unknown
  reading: string; // what was observed, in words
  known: boolean; // false = not set / could not be fetched, contributes nothing
  hint: string; // what would move this signal
};

export type RegimeBand = "STRONG_RISK_ON" | "RISK_ON" | "NEUTRAL" | "RISK_OFF" | "CRISIS";

export type RegimeVerdict = {
  signals: RegimeSignal[];
  knownCount: number;
  rawScore: number; // straight sum, the number you would tally by hand
  maxScore: number; // 2 x known signals
  normalised: number; // -100..+100, so the bands work with any signal count
  band: RegimeBand;
  label: string;
  cashFloorPct: number; // minimum cash this environment argues for
  favour: string[];
  avoid: string[];
  line: string; // one sentence for the dashboard
  confidence: "LOW" | "MEDIUM" | "HIGH"; // from how many signals are actually known
  missing: string[]; // signals not set, so you know what would sharpen it
};

const BANDS: Array<{
  band: RegimeBand;
  min: number;
  label: string;
  cashFloorPct: number;
  favour: string[];
  avoid: string[];
  instruction: string;
}> = [
  {
    band: "STRONG_RISK_ON",
    min: 55,
    label: "Strong risk-on",
    cashFloorPct: 5,
    favour: ["Banks", "Cement", "Autos", "Cyclicals", "Mid and small caps"],
    avoid: ["Holding large cash", "Defensives"],
    instruction: "Deploy the ladder fully. Cash is the risk here, not the shelter.",
  },
  {
    band: "RISK_ON",
    min: 12,
    label: "Risk-on",
    cashFloorPct: 10,
    favour: ["Banks", "Cement", "Cyclicals", "Quality growth"],
    avoid: ["Over-hedging", "Sitting out dips"],
    instruction: "Buy dips on the normal schedule. Do not front-run the ladder.",
  },
  {
    band: "NEUTRAL",
    min: -15,
    label: "Neutral",
    cashFloorPct: 20,
    favour: ["High dividend", "Low debt", "Names already in their buy band"],
    avoid: ["Leverage", "Thesis-free additions"],
    instruction: "Be selective. Only names at your levels, only planned sizes.",
  },
  {
    band: "RISK_OFF",
    min: -50,
    label: "Risk-off",
    cashFloorPct: 40,
    favour: ["Oil and gas", "Fertiliser", "High-dividend banks", "Staples", "Cash"],
    avoid: ["Autos", "Cement", "Consumer discretionary", "High beta", "Leveraged names"],
    instruction: "Hold cash. Deploy only at deep support, only the planned rung.",
  },
  {
    band: "CRISIS",
    min: -101,
    label: "Crisis",
    cashFloorPct: 60,
    favour: ["Cash", "Short duration", "USD earners", "Highest-quality dividend payers"],
    avoid: ["Growth", "Leverage", "Anything illiquid"],
    instruction: "Capital preservation first. The ladder waits for its lowest rungs.",
  },
];

export const SIGNAL_HINTS: Record<string, string> = {
  trend200: "Index against its own 200-day average. Above and rising is offense.",
  cross: "50-day average against the 200-day. A cross is slow but honest.",
  oil: "Brent over three months. Pakistan imports it, so up is a headwind.",
  pkr: "Rupee against the dollar over three months. Weakness imports inflation.",
  policy: "SBP policy rate direction. Cuts loosen, hikes tighten.",
  cpi: "Inflation direction. Falling gives the SBP room.",
  foreign: "NCCPL FIPI net. Foreign selling drains the market's marginal bid.",
  politics: "Your own read: IMF, elections, security, cabinet stability.",
  breadth: "How many names are participating. A narrow rally is a fragile one.",
};

export function scoreRegime(signals: RegimeSignal[]): RegimeVerdict {
  const list = signals ?? [];
  const known = list.filter((s) => s.known);
  const rawScore = known.reduce((s, x) => s + clamp(x.score), 0);
  const maxScore = known.length * 2;
  const normalised = maxScore > 0 ? (rawScore / maxScore) * 100 : 0;

  const hit = BANDS.find((b) => normalised >= b.min) ?? BANDS[BANDS.length - 1];

  const confidence: RegimeVerdict["confidence"] =
    known.length >= 7 ? "HIGH" : known.length >= 4 ? "MEDIUM" : "LOW";

  const missing = list.filter((s) => !s.known).map((s) => s.label);

  const line =
    known.length === 0
      ? "No signals set. Fill the scorecard before you let a mood decide your cash level."
      : `${hit.label}. Score ${rawScore >= 0 ? "+" : ""}${rawScore} of ${maxScore}. ${hit.instruction}`;

  return {
    signals: list,
    knownCount: known.length,
    rawScore,
    maxScore,
    normalised,
    band: hit.band,
    label: hit.label,
    cashFloorPct: hit.cashFloorPct,
    favour: hit.favour,
    avoid: hit.avoid,
    line,
    confidence,
    missing,
  };
}

// Does the cash you actually hold clear the floor this regime argues for?
export function cashCheck(verdict: RegimeVerdict, cashPct: number): {
  ok: boolean;
  gapPct: number;
  line: string;
} {
  const floor = verdict.cashFloorPct;
  const gap = cashPct - floor;
  if (verdict.knownCount === 0) {
    return { ok: true, gapPct: 0, line: "Scorecard empty — no cash floor to check against." };
  }
  if (gap >= 0) {
    return {
      ok: true,
      gapPct: gap,
      line: `Cash is ${cashPct.toFixed(0)}% against a ${floor}% floor for a ${verdict.label.toLowerCase()} market. You have ${gap.toFixed(0)} points of room to buy.`,
    };
  }
  return {
    ok: false,
    gapPct: gap,
    line: `Cash is ${cashPct.toFixed(0)}% but a ${verdict.label.toLowerCase()} market argues for at least ${floor}%. You are ${Math.abs(gap).toFixed(0)} points short — raise cash or stop buying, do not do both halfway.`,
  };
}

// --- helpers that turn a raw observation into a -2..+2 score -----------------

// Index against its 200-day average, and whether that average is itself rising.
// Both matter: above a falling average is a rally inside a downtrend.
export function scoreTrend200(price: number, ma200: number, ma200SlopePct: number): { score: number; reading: string } {
  if (!(price > 0) || !(ma200 > 0)) return { score: 0, reading: "not enough history" };
  const abovePct = ((price - ma200) / ma200) * 100;
  const above = abovePct >= 0;
  const rising = ma200SlopePct > 0.5;
  const falling = ma200SlopePct < -0.5;
  let score = 0;
  if (above && rising) score = 2;
  else if (above && !falling) score = 1;
  else if (above && falling) score = 0;
  else if (!above && rising) score = -1;
  else score = -2;
  return {
    score,
    reading: `${abovePct >= 0 ? "+" : ""}${abovePct.toFixed(1)}% vs 200DMA, which is ${
      rising ? "rising" : falling ? "falling" : "flat"
    }`,
  };
}

export function scoreCross(ma50: number, ma200: number): { score: number; reading: string } {
  if (!(ma50 > 0) || !(ma200 > 0)) return { score: 0, reading: "not enough history" };
  const gap = ((ma50 - ma200) / ma200) * 100;
  const score = gap > 3 ? 2 : gap > 0 ? 1 : gap > -3 ? -1 : -2;
  return { score, reading: `50DMA is ${gap >= 0 ? "+" : ""}${gap.toFixed(1)}% vs 200DMA` };
}

// Oil: Pakistan is a net importer, so a rising crude price is a headwind.
export function scoreOil(changePct: number): { score: number; reading: string } {
  const score = changePct > 15 ? -2 : changePct > 5 ? -1 : changePct < -15 ? 2 : changePct < -5 ? 1 : 0;
  return { score, reading: `Brent ${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}% over 3 months` };
}

// Rupee: depreciation imports inflation and scares foreign money.
export function scorePkr(changePct: number): { score: number; reading: string } {
  const score = changePct > 5 ? -2 : changePct > 1.5 ? -1 : changePct < -2 ? 1 : 0;
  return { score, reading: `USD/PKR ${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}% over 3 months` };
}

// Policy rate: the direction matters more than the level.
export function scorePolicy(changeBps: number): { score: number; reading: string } {
  const score = changeBps <= -200 ? 2 : changeBps < 0 ? 1 : changeBps >= 200 ? -2 : changeBps > 0 ? -1 : 0;
  const dir = changeBps === 0 ? "unchanged" : `${changeBps > 0 ? "+" : ""}${changeBps}bps`;
  return { score, reading: `policy rate ${dir} over 6 months` };
}

export function scoreCpi(changePp: number): { score: number; reading: string } {
  const score = changePp <= -3 ? 2 : changePp < -0.5 ? 1 : changePp >= 3 ? -2 : changePp > 0.5 ? -1 : 0;
  return {
    score,
    reading: `CPI ${changePp >= 0 ? "+" : ""}${changePp.toFixed(1)}pp over 6 months`,
  };
}

// Foreign flows. PSX is thin enough that the marginal foreign bid moves it, so
// sustained net selling is a real headwind whatever the fundamentals say. The
// twenty-day net carries the score because five days is mostly noise; the
// shorter number is reported next to it so a turn is visible early.
export function scoreForeign(net20dUsdMn: number, net5dUsdMn: number): { score: number; reading: string } {
  const n = Number.isFinite(net20dUsdMn) ? net20dUsdMn : 0;
  const score = n > 25 ? 2 : n > 5 ? 1 : n < -25 ? -2 : n < -5 ? -1 : 0;
  const fmt = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(1);
  return {
    score,
    reading: `foreigners net ${fmt(n)}m USD over 20 days, ${fmt(net5dUsdMn)}m over 5`,
  };
}

// Breadth. A rally carried by four large caps is a fragile one, so this counts
// how many names actually rose. Advances as a share of the names that moved at
// all: a market where a third of the board is untraded should not be scored as
// if two thirds of it fell.
export function scoreBreadth(advancePct: number, sessions: number): { score: number; reading: string } {
  const p = Number.isFinite(advancePct) ? advancePct : 50;
  const score = p > 62 ? 2 : p > 54 ? 1 : p >= 46 ? 0 : p > 38 ? -1 : -2;
  const over = sessions > 1 ? ` averaged over ${sessions} sessions` : " on the latest session only";
  return { score, reading: `${p.toFixed(0)}% of moving KSE-100 names advancing${over}` };
}

function clamp(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-2, Math.min(2, v));
}

// The manual signals, with the wording used on the form. Kept here so the page
// and the API agree on what each level means.
export const MANUAL_SIGNALS: Array<{ key: string; label: string; options: Array<{ score: number; text: string }> }> = [
  {
    key: "foreign",
    label: "Foreign flows",
    options: [
      { score: 2, text: "Sustained net buying" },
      { score: 1, text: "Mild net buying" },
      { score: 0, text: "Flat or mixed" },
      { score: -1, text: "Mild net selling" },
      { score: -2, text: "Heavy net selling" },
    ],
  },
  {
    key: "politics",
    label: "Politics and macro",
    options: [
      { score: 2, text: "Stable, IMF on track" },
      { score: 1, text: "Calm enough" },
      { score: 0, text: "Background noise" },
      { score: -1, text: "Noisy, IMF or budget risk" },
      { score: -2, text: "Crisis, programme or security risk" },
    ],
  },
  {
    key: "breadth",
    label: "Market breadth",
    options: [
      { score: 2, text: "Broad, small caps joining" },
      { score: 1, text: "Healthy" },
      { score: 0, text: "Mixed" },
      { score: -1, text: "Narrow, a few large caps holding it up" },
      { score: -2, text: "Very narrow, most names falling" },
    ],
  },
];
