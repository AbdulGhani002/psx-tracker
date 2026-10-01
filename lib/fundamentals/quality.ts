// Quality and price for one company, and for a portfolio of them.
//
// Price: the P/E on the latest annual EPS, and a cycle-adjusted P/E in the
// manner of Shiller's CAPE: price over the average of the past years' EPS,
// each restated in today's rupees with the PBS consumer price index. Shiller
// averages ten years; the exchange's company page carries four, so the window
// here is what the data allows and is labelled with its length.
//
// Quality: return on equity, from the equity the company's own statement of
// financial position reports (lib/prices/balance-sheet.ts) or, where none
// could be read, the book value per share entered on the holding; split by
// DuPont into margin, asset turnover and leverage, so a high ROE bought with
// borrowing is visible as such. Beside it, the cost of equity (the SBP rate
// plus the equity premium, as in the intrinsic valuation): a company earning
// more than that on its equity creates value, one earning less destroys it.
//
// The quadrant puts the two together: return on equity against its cost, and
// the cycle-adjusted P/E against the market's median (PSX multiples sit low
// across the board, so an absolute threshold would call everything cheap).
//
//   compounder  ROE above its cost, CAPE below the market's: quality, cheap
//   premium     ROE above its cost, CAPE above the market's: quality, priced in
//   trap        ROE below its cost, CAPE below the market's: cheap for a reason
//   danger      ROE below its cost, CAPE above the market's: poor and dear

export type AnnualRow = { fiscalYear: number; eps: number | null; profitAfterTax: number | null; revenue: number | null; netMarginPct: number | null; grossMarginPct?: number | null };
export type CpiPoint = { period: string; index: number }; // "YYYY-MM"
export type BalanceInput = { periodEnd: string; equity: number; totalAssets: number; source?: string | null; consolidated?: boolean };

export type QualityInput = {
  price: number;
  shares: number | null;
  annual: AnnualRow[];
  fiscalYearEndMonth: number; // 1..12, June for most PSX companies
  dividendsTtm: number | null; // cash dividends per share declared in the last twelve months
  balance: BalanceInput | null;
  manualBvps: number | null;
  cpi: CpiPoint[];
  costOfEquityPct: number;
  marketMedianCape?: number | null;
};

export type Quadrant = "compounder" | "premium" | "trap" | "danger";
export type Grade = "A" | "B" | "C" | "D";

export type Quality = {
  latestYear: number | null;
  years: number; // annual rows with an EPS
  pe: number | null;
  earningsYieldPct: number | null;
  cape: number | null;
  capeYears: number;
  realEps: Array<{ fiscalYear: number; eps: number; real: number }>;
  epsCagrPct: number | null;
  revenueCagrPct: number | null;
  netMarginPct: number | null;
  netMarginTrendPp: number | null; // latest less the oldest in the window
  grossMarginPct: number | null;
  profitableYears: number;
  dividendYieldPct: number | null;
  payoutPct: number | null;
  bvps: number | null;
  bookSource: "statement" | "manual" | null;
  pb: number | null;
  roePct: number | null;
  dupont: { netMarginPct: number; assetTurnover: number; equityMultiplier: number } | null;
  costOfEquityPct: number;
  spreadPp: number | null; // ROE less its cost
  justifiedPb: number | null;
  capeYieldPct: number | null; // 1 / CAPE: the real return the price implies on average earnings
  sustainableGrowthPct: number | null; // ROE x the share of earnings kept
  impliedReturnPct: number | null; // dividend yield + sustainable growth, against the cost of equity
  quadrant: Quadrant | null;
  grade: Grade | null;
  notes: string[];
};

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

// The CPI index at a fiscal year's end, or the nearest month the series has
// within three months of it; null when the series does not reach back.
export function cpiAt(cpi: CpiPoint[], year: number, month: number): number | null {
  const key = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
  const by = new Map(cpi.map((p) => [p.period.slice(0, 7), p.index]));
  for (let k = 0; k <= 3; k++) {
    for (const dir of [0, -1, 1]) {
      const d = new Date(Date.UTC(year, month - 1 + dir * k, 1));
      const v = by.get(key(d.getUTCFullYear(), d.getUTCMonth() + 1));
      if (v) return v;
    }
  }
  return null;
}

export function quality(i: QualityInput): Quality {
  const notes: string[] = [];
  // Ten years at most, Shiller's window; the history grows a year at a time
  // as the job keeps the years the exchange's page drops.
  const rows = [...i.annual].filter((r) => r.eps != null).sort((a, b) => b.fiscalYear - a.fiscalYear).slice(0, 10);
  const latest = rows[0] ?? null;
  const oldest = rows[rows.length - 1] ?? null;
  const n = rows.length;
  const latestEps = latest?.eps ?? null;
  const pe = latestEps != null && latestEps > 0 && i.price > 0 ? i.price / latestEps : null;
  const earningsYieldPct = latestEps != null && i.price > 0 ? (latestEps / i.price) * 100 : null;

  // Every year's EPS in today's rupees.
  const now = i.cpi.length ? i.cpi[i.cpi.length - 1].index : null;
  const realEps: Quality["realEps"] = [];
  for (const r of rows) {
    const at = cpiAt(i.cpi, r.fiscalYear, i.fiscalYearEndMonth);
    if (now && at) realEps.push({ fiscalYear: r.fiscalYear, eps: r.eps!, real: r.eps! * (now / at) });
  }
  if (realEps.length < n && n > 0) notes.push(`The price index does not reach back to every year, so ${realEps.length} of ${n} years are restated.`);
  const meanReal = realEps.length ? realEps.reduce((s, r) => s + r.real, 0) / realEps.length : null;
  const cape = realEps.length >= 3 && meanReal != null && meanReal > 0 && i.price > 0 ? i.price / meanReal : null;
  if (realEps.length >= 3 && meanReal != null && meanReal <= 0) notes.push("Losses on average over the window: no cycle-adjusted P/E.");

  const cagr = (a: number | null | undefined, b: number | null | undefined, years: number) => (a != null && b != null && a > 0 && b > 0 && years > 0 ? (Math.pow(a / b, 1 / years) - 1) * 100 : null);
  const span = latest && oldest ? latest.fiscalYear - oldest.fiscalYear : 0;
  const epsCagrPct = cagr(latest?.eps, oldest?.eps, span);
  const revenueCagrPct = cagr(latest?.revenue, oldest?.revenue, span);
  const netMarginPct = latest?.netMarginPct ?? (latest?.profitAfterTax != null && latest?.revenue ? (latest.profitAfterTax / latest.revenue) * 100 : null);
  const oldMargin = oldest?.netMarginPct ?? null;
  const netMarginTrendPp = netMarginPct != null && oldMargin != null && span > 0 ? netMarginPct - oldMargin : null;
  const grossMarginPct = latest?.grossMarginPct ?? null;
  const profitableYears = rows.filter((r) => (r.eps ?? 0) > 0).length;

  // Dividends: the cash declared over the last twelve months.
  const dps = i.dividendsTtm;
  const dividendYieldPct = dps == null ? null : i.price > 0 ? (dps / i.price) * 100 : null;
  const payoutPct = dps == null ? null : latestEps != null && latestEps > 0 ? (dps / latestEps) * 100 : null;

  // Book value and return on equity.
  let bvps: number | null = null, bookSource: Quality["bookSource"] = null, roePct: number | null = null, dupont: Quality["dupont"] = null;
  if (i.balance && i.shares && i.shares > 0 && i.balance.equity > 0) {
    bvps = i.balance.equity / i.shares;
    bookSource = "statement";
    const pat = latest?.profitAfterTax != null ? latest.profitAfterTax * 1000 : null; // the portal reports thousands
    if (pat != null) roePct = (pat / i.balance.equity) * 100;
    const rev = latest?.revenue != null ? latest.revenue * 1000 : null;
    if (pat != null && rev && rev > 0 && i.balance.totalAssets > 0) dupont = { netMarginPct: (pat / rev) * 100, assetTurnover: rev / i.balance.totalAssets, equityMultiplier: i.balance.totalAssets / i.balance.equity };
  } else if (i.manualBvps && i.manualBvps > 0) {
    bvps = i.manualBvps;
    bookSource = "manual";
    if (latestEps != null) roePct = (latestEps / i.manualBvps) * 100;
  }
  let pb = bvps && i.price > 0 ? i.price / bvps : null;
  // A book value that puts the price at less than a twentieth or more than
  // fifty times book is a misread statement, not a valuation.
  if (pb != null && (pb < 0.05 || pb > 50)) {
    notes.push(`Book value per share ${round(bvps!)} against a price of ${round(i.price)} is not credible; set aside.`);
    bvps = null; pb = null; roePct = null; dupont = null; bookSource = null;
  }
  if (bookSource === "statement" && i.balance?.consolidated) notes.push("Equity is from the consolidated statement; the standalone one could not be read.");

  const r = i.costOfEquityPct;
  const spreadPp = roePct != null ? roePct - r : null;
  // Justified P/B from the Gordon model: (ROE - g) / (r - g), growth the
  // retained share of ROE, kept below the cost of equity.
  let justifiedPb: number | null = null;
  if (roePct != null && r > 0) {
    const retain = payoutPct != null ? Math.max(0, 1 - payoutPct / 100) : 0.5;
    const g = Math.min(roePct * retain, r - 2, 12);
    justifiedPb = r - g > 0 ? Math.max(0, (roePct - g) / (r - g)) : null;
  }

  // What the price implies. The cycle-adjusted earnings yield is the
  // measure Shiller found to track the following decade's real returns; the
  // implied return is what a buyer at this price earns if the company keeps
  // paying out what it does and grows by reinvesting the rest at its ROE.
  // Neither is a forecast of the price: both say what the business, carrying
  // on as it is, returns on today's price.
  const capeYieldPct = cape != null && cape > 0 ? 100 / cape : null;
  const sustainableGrowthPct = roePct != null ? Math.max(0, Math.min(roePct * (payoutPct != null ? Math.max(0, 1 - payoutPct / 100) : 0.5), 20)) : null;
  const impliedReturnPct = sustainableGrowthPct != null && dividendYieldPct != null ? dividendYieldPct + sustainableGrowthPct : null;

  let quadrant: Quadrant | null = null;
  const capeRef = i.marketMedianCape ?? null;
  if (roePct != null && cape != null && capeRef != null) {
    const good = roePct >= r, cheap = cape <= capeRef;
    quadrant = good ? (cheap ? "compounder" : "premium") : cheap ? "trap" : "danger";
  }

  // The grade: the return on equity against its cost first, then whether the
  // earnings are growing and have stayed positive.
  let grade: Grade | null = null;
  if (roePct != null) {
    const steady = profitableYears === n && n > 0;
    const growing = epsCagrPct != null && epsCagrPct > 0;
    if (roePct >= r + 5 && steady && growing) grade = "A";
    else if (roePct >= r && steady) grade = "B";
    else if (roePct >= r - 5 || (steady && growing)) grade = "C";
    else grade = "D";
  } else if (n >= 3) {
    notes.push("No balance sheet could be read for this company, so there is no return on equity; enter its book value per share on the holding to add one.");
  }

  return {
    latestYear: latest?.fiscalYear ?? null,
    years: n,
    pe,
    earningsYieldPct,
    cape,
    capeYears: realEps.length,
    realEps,
    epsCagrPct,
    revenueCagrPct,
    netMarginPct,
    netMarginTrendPp,
    grossMarginPct,
    profitableYears,
    dividendYieldPct,
    payoutPct,
    bvps,
    bookSource,
    pb,
    roePct,
    dupont,
    costOfEquityPct: r,
    spreadPp,
    justifiedPb,
    capeYieldPct,
    sustainableGrowthPct,
    impliedReturnPct,
    quadrant,
    grade,
    notes,
  };
}

export const QUADRANT_TEXT: Record<Quadrant, { title: string; line: string }> = {
  compounder: { title: "Undervalued compounder", line: "Earns more than its cost of equity and is priced below the market's cycle-adjusted multiple." },
  premium: { title: "Quality at a premium", line: "Earns more than its cost of equity, and the market already prices it above its median multiple." },
  trap: { title: "Possible value trap", line: "Looks cheap, but earns less than its cost of equity: the low multiple may be deserved." },
  danger: { title: "Poor and dear", line: "Earns less than its cost of equity and is priced above the market's median multiple." },
};

export const median = (v: number[]): number | null => {
  const s = v.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (s.length === 0) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// A portfolio's figures, weighted by market value. Multiples combine the
// way an index's do, as total value over total earnings (a harmonic mean),
// so one name on a huge P/E cannot dominate; rates are value-weighted means
// over the names that have them, with the share of value covered alongside.
export type PortfolioQuality = {
  value: number;
  pe: number | null;
  cape: number | null;
  earningsYieldPct: number | null;
  dividendYieldPct: number | null;
  roePct: number | null;
  pb: number | null;
  epsCagrPct: number | null;
  capeYieldPct: number | null;
  impliedReturnPct: number | null;
  netMarginPct: number | null;
  coverage: { pe: number; cape: number; roe: number };
  quadrants: Record<Quadrant | "unknown", number>; // share of value
  grades: Record<Grade | "unknown", number>;
};

export function portfolioQuality(holdings: Array<{ value: number; q: Quality }>): PortfolioQuality {
  const V = holdings.reduce((s, h) => s + Math.max(0, h.value), 0);
  const harmonic = (get: (q: Quality) => number | null) => {
    let v = 0, inv = 0;
    for (const h of holdings) {
      const m = get(h.q);
      if (m != null && m > 0) { v += h.value; inv += h.value / m; }
    }
    return { m: inv > 0 ? v / inv : null, cover: V > 0 ? v / V : 0 };
  };
  const weighted = (get: (q: Quality) => number | null) => {
    let v = 0, s = 0;
    for (const h of holdings) {
      const x = get(h.q);
      if (x != null && Number.isFinite(x)) { v += h.value; s += h.value * x; }
    }
    return { m: v > 0 ? s / v : null, cover: V > 0 ? v / V : 0 };
  };
  const pe = harmonic((q) => q.pe), cape = harmonic((q) => q.cape), pb = harmonic((q) => q.pb);
  const roe = weighted((q) => q.roePct);
  const quadrants = { compounder: 0, premium: 0, trap: 0, danger: 0, unknown: 0 };
  const grades = { A: 0, B: 0, C: 0, D: 0, unknown: 0 };
  for (const h of holdings) {
    const w = V > 0 ? h.value / V : 0;
    quadrants[h.q.quadrant ?? "unknown"] += w;
    grades[h.q.grade ?? "unknown"] += w;
  }
  return {
    value: V,
    pe: pe.m,
    cape: cape.m,
    earningsYieldPct: weighted((q) => q.earningsYieldPct).m,
    dividendYieldPct: weighted((q) => q.dividendYieldPct).m,
    roePct: roe.m,
    pb: pb.m,
    epsCagrPct: weighted((q) => q.epsCagrPct).m,
    capeYieldPct: cape.m != null && cape.m > 0 ? 100 / cape.m : null,
    impliedReturnPct: weighted((q) => q.impliedReturnPct).m,
    netMarginPct: weighted((q) => q.netMarginPct).m,
    coverage: { pe: pe.cover, cape: cape.cover, roe: roe.cover },
    quadrants,
    grades,
  };
}

// Cash dividends per share declared in the last twelve months. Each payout
// cycle counts once (its newest), so a final announced eleven months after
// the last year's final is not counted twice. null when the company's payout
// history has not been read at all.
export function dividendsTtm(
  payouts: Array<{ date?: string | null; bookClosure?: string | null; pctOfFace: number; cycle?: string; payoutType?: string }>,
  faceValue: number,
  today: string
): number | null {
  if (!payouts || payouts.length === 0) return null;
  const from = new Date(Date.parse(today) - 365 * 86400000).toISOString().slice(0, 10);
  const byCycle = new Map<string, { date: string; dps: number }>();
  let unlabelled = 0;
  for (const p of payouts) {
    const d = p.date ?? p.bookClosure ?? null;
    if (!d || d < from || d > today || (p.payoutType ?? "cash") !== "cash" || !(p.pctOfFace > 0)) continue;
    const dps = (p.pctOfFace / 100) * (faceValue || 10);
    const c = (p.cycle ?? "").trim();
    if (!c) { unlabelled += dps; continue; }
    const prev = byCycle.get(c);
    if (!prev || d > prev.date) byCycle.set(c, { date: d, dps });
  }
  return [...byCycle.values()].reduce((s, v) => s + v.dps, 0) + unlabelled;
}
