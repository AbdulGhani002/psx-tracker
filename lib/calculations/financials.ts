// Valuing banks, insurers and other balance-sheet businesses.
//
// A bank cannot be valued the way a cement maker is, and running an earnings
// DCF over one is not a rough answer — it is the wrong question. Three reasons:
//
//   1. Free cash flow is undefined for a bank. Deposits are funding, not cash
//      generated; loans are the product, not capex. "Cash from operations"
//      swings on deposit flows and says nothing about earning power.
//   2. Earnings are provision-driven and cyclical. One year's EPS reflects the
//      credit cycle more than the franchise.
//   3. The balance sheet IS the business. Equity is the constraint on how much
//      a bank can lend, so book value is the anchor and the question is only
//      what return is earned ON that book.
//
// So the standard is residual income and justified price-to-book, both of which
// value the excess of ROE over the cost of equity. A bank earning exactly its
// cost of equity is worth exactly its book value — no more, however large its
// earnings look.

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

// PSX sector names for businesses where book value, not free cash flow, is the
// anchor. Matched loosely because the portal's spelling varies.
const FINANCIAL_PATTERNS = [
  /commercial\s*bank/i,
  /\bbank/i,
  /insurance/i,
  /investment\s*bank|securities\s*co|investment\s*cos/i,
  /modaraba/i,
  /leasing/i,
];

export function isFinancialSector(sector: string | null | undefined): boolean {
  const s = (sector ?? "").trim();
  if (!s) return false;
  return FINANCIAL_PATTERNS.some((re) => re.test(s));
}

// Sustainable growth: what the balance sheet can fund out of retained profit
// alone, without issuing shares. g = ROE × (1 − payout). Using a general
// "earnings growth" figure here instead would let a bank grow its book faster
// than it can actually fund, which is how these models produce silly numbers.
export function sustainableGrowthPct(roePct: number, payoutRatio: number): number {
  const retention = clamp(1 - payoutRatio, 0, 1);
  return roePct * retention;
}

export type ResidualIncomeResult = {
  value: number; // intrinsic per share
  bookValue: number; // the anchor
  presentValueOfExcess: number; // everything above book, in rupees per share
  terminalShare: number; // how much of the excess sits in the terminal value (0..1)
  rows: Array<{ year: number; openingBook: number; roePct: number; residual: number; discounted: number }>;
};

// Residual income: V = B₀ + Σ (ROE_t − r) × B_{t−1} / (1+r)^t + terminal.
//
// ROE FADES toward the cost of equity across the horizon. That is not
// conservatism for its own sake — excess returns attract competition and
// regulation, and a model that lets a bank earn 25% on equity forever will
// value every profitable bank at several times book. The terminal value applies
// a persistence factor to whatever excess survives.
export function residualIncomeValue(args: {
  bookValuePerShare: number;
  roePct: number;
  requiredReturnPct: number;
  payoutRatio: number;
  years?: number;
  fadeToPct?: number | null; // long-run ROE; defaults to r + 1.5pp of durable edge
  persistence?: number; // 0..1 — share of terminal excess that endures
}): ResidualIncomeResult | null {
  const B0 = args.bookValuePerShare;
  const r = args.requiredReturnPct / 100;
  if (!(B0 > 0) || !Number.isFinite(args.roePct) || !(r > 0)) return null;

  const years = Math.max(1, Math.min(20, args.years ?? 10));
  const persistence = clamp(args.persistence ?? 0.5, 0, 0.95);
  const startRoe = clamp(args.roePct, -50, 60);
  const payout = clamp(args.payoutRatio, 0, 1);

  // The fade must always move ROE TOWARD the cost of equity, never away from
  // it. Defaulting the target to r + edge unconditionally meant a bank already
  // earning exactly r was faded UP to r + 1.5 — manufacturing an excess out of
  // nothing and valuing it above book. A bank earning its cost of equity is
  // worth its book value, and that identity is what this model exists to keep.
  const DURABLE_EDGE_PP = 1.5;
  const rPct = args.requiredReturnPct;
  let endRoe: number;
  if (args.fadeToPct != null) endRoe = args.fadeToPct;
  else if (startRoe > rPct + DURABLE_EDGE_PP) endRoe = rPct + DURABLE_EDGE_PP; // excess decays to a small durable edge
  else if (startRoe < rPct) endRoe = rPct; // a deficit erodes too: it is fixed, or the bank shrinks
  else endRoe = startRoe; // already inside the band — nothing to fade

  let book = B0;
  let pv = 0;
  const rows: ResidualIncomeResult["rows"] = [];
  let lastResidual = 0;

  for (let t = 1; t <= years; t++) {
    // Linear fade from the current ROE to the long-run one.
    const roePct = startRoe + ((endRoe - startRoe) * t) / years;
    const residual = ((roePct - args.requiredReturnPct) / 100) * book;
    const discounted = residual / Math.pow(1 + r, t);
    pv += discounted;
    rows.push({ year: t, openingBook: book, roePct, residual, discounted });
    lastResidual = residual;
    // Book compounds only by what is retained.
    book = book * (1 + ((roePct / 100) * (1 - payout)));
  }

  // Continuing value of the residual that persists past the horizon.
  const terminal = persistence > 0 ? (lastResidual * persistence) / (1 + r - persistence) / Math.pow(1 + r, years) : 0;
  const excess = pv + terminal;
  const value = B0 + excess;
  if (!Number.isFinite(value) || value <= 0) return null;

  return {
    value,
    bookValue: B0,
    presentValueOfExcess: excess,
    terminalShare: excess !== 0 ? terminal / excess : 0,
    rows,
  };
}

export type JustifiedPbResult = {
  value: number; // intrinsic per share
  multiple: number; // the justified P/B itself
  roePct: number;
  growthPct: number;
};

// Justified price-to-book: P/B = (ROE − g) / (r − g).
//
// The cleanest statement of what a bank is worth. It falls straight out of the
// Gordon model once you write the dividend as ROE × book × payout, and it makes
// the central fact unmissable: when ROE equals r, the multiple is exactly 1.0.
// Returns null rather than a number when r ≤ g, because the formula does not
// merely become inaccurate there — it becomes meaningless, and a negative or
// exploding multiple presented as a valuation is worse than no valuation.
export function justifiedPriceToBook(args: {
  bookValuePerShare: number;
  roePct: number;
  requiredReturnPct: number;
  growthPct: number;
}): JustifiedPbResult | null {
  const { bookValuePerShare: B, roePct, requiredReturnPct: r } = args;
  // Growth above the cost of equity forever is not a thing a bank can do.
  const g = Math.min(args.growthPct, r - 1);
  if (!(B > 0) || !Number.isFinite(roePct) || !(r > g)) return null;
  const multiple = (roePct - g) / (r - g);
  if (!Number.isFinite(multiple) || multiple <= 0) return null;
  // A justified multiple past ~5x book says the inputs are wrong, not that the
  // bank is worth five times its equity.
  const capped = Math.min(multiple, 5);
  const value = capped * B;
  if (!Number.isFinite(value) || value <= 0) return null;
  return { value, multiple: capped, roePct, growthPct: g };
}

// ROE implied by what we already know: normalised earning power over book.
// Uses through-cycle EPS rather than the latest year, for the same reason the
// rest of the engine does — one year of a bank's earnings is a statement about
// the credit cycle.
export function impliedRoePct(normalisedEps: number | null, bookValuePerShare: number): number | null {
  if (normalisedEps == null || !(bookValuePerShare > 0)) return null;
  const roe = (normalisedEps / bookValuePerShare) * 100;
  return Number.isFinite(roe) ? roe : null;
}
