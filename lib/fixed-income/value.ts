// T-bills and sukuks: what one is worth today, what it has earned, and what
// it yields.
//
// A T-bill pays nothing until it matures at its face value; it is bought at
// a discount. Its worth grows from what was paid to the face value in a
// straight line over its life (the market's simple-yield convention, a
// 365-day year), and its yield is the discount over the price, a year.
//
// A sukuk pays its profit rate on the face value in coupons (twice a year
// for the GoP Ijara sukuks), on dates counted back from its maturity, and
// repays the face value at maturity. Its worth is what was paid, pulled to
// the face value in a straight line over its life (a premium or discount
// wears off), plus the profit accrued since the last coupon; or, when a
// market price is entered, the face value at that price plus the accrual.
// Coupons already paid are income, not worth: they went to cash.
//
// No server imports, so scripts/test-fixed-income.ts can run it.

export type FixedIncomeKind = "tbill" | "sukuk";

export type FixedIncomeHolding = {
  kind: FixedIncomeKind;
  name: string;
  face: number; // total face value, rupees
  cost: number; // what was paid, rupees, fees included
  purchaseDate: string; // yyyy-mm-dd
  maturityDate: string; // yyyy-mm-dd
  couponPct: number; // a sukuk's profit rate a year on face; 0 for a T-bill
  couponsPerYear: number; // 2 for half-yearly; 0 for none
  taxPct: number; // withheld on the profit
  pricePct?: number | null; // a market price, % of face, when known
};

export type FixedIncomeValue = {
  value: number; // today's worth
  profitSoFar: number; // earned so far before tax: worth less cost, plus coupons paid
  couponsPaid: number;
  couponsPaidCount: number;
  yieldPct: number; // a year, at the price paid, to maturity
  afterTaxYieldPct: number;
  termDays: number;
  daysLeft: number;
  matured: boolean;
  nextCouponDate: string | null;
  atMaturity: number; // what it pays from today to maturity: face plus the coupons still to come
};

const DAY = 86400000;
const t = (iso: string) => Date.parse(iso + "T00:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// A date `months` before `from`, the day clamped to the month's last.
function monthsBefore(fromIso: string, months: number): string {
  const d = new Date(fromIso + "T00:00:00Z");
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return iso(d.getTime());
}

// The coupon dates after `after` up to maturity, counted back from maturity.
export function couponDates(h: Pick<FixedIncomeHolding, "maturityDate" | "couponsPerYear">, after: string): string[] {
  if (!(h.couponsPerYear > 0)) return [];
  const step = Math.round(12 / h.couponsPerYear);
  const out: string[] = [];
  for (let k = 0; k < 400; k++) {
    const d = monthsBefore(h.maturityDate, k * step);
    if (d <= after) break;
    out.push(d);
  }
  return out.reverse();
}

export function valueFixedIncome(h: FixedIncomeHolding, today: string): FixedIncomeValue {
  const t0 = t(h.purchaseDate), t1 = t(h.maturityDate), now = Math.min(t(today), t1);
  const termDays = Math.max(1, Math.round((t1 - t0) / DAY));
  const elapsed = Math.max(0, Math.min(1, (now - t0) / (t1 - t0 || 1)));
  const daysLeft = Math.max(0, Math.round((t1 - t(today)) / DAY));
  const matured = t(today) >= t1;
  const perCoupon = h.couponsPerYear > 0 ? (h.face * (h.couponPct / 100)) / h.couponsPerYear : 0;

  // Coupons paid between the purchase and today (a sukuk bought just before a
  // coupon date gets that coupon; the price paid included the accrual).
  const all = couponDates(h, h.purchaseDate);
  const paid = all.filter((d) => t(d) <= Math.min(t(today), t1));
  const couponsPaid = paid.length * perCoupon;
  const lastPaid = paid.length ? paid[paid.length - 1] : null;
  const next = all.find((d) => t(d) > t(today)) ?? null;
  // Accrued since the last coupon (or the one before the purchase).
  const accrualFrom = lastPaid ?? (next ? monthsBefore(next, Math.round(12 / Math.max(1, h.couponsPerYear))) : h.purchaseDate);
  const accrued = !matured && h.couponsPerYear > 0 ? h.face * (h.couponPct / 100) * Math.max(0, (now - t(accrualFrom)) / DAY) / 365 : 0;

  const pulled = h.cost + (h.face - h.cost) * elapsed;
  const base = matured ? h.face : h.pricePct != null && h.pricePct > 0 ? (h.face * h.pricePct) / 100 : pulled;
  const value = base + accrued;

  // The yield at the price paid, a year: the discount (or premium) worn off
  // over the term plus the coupons, on the cost.
  const years = termDays / 365;
  const couponsAll = all.length * perCoupon;
  const yieldPct = h.cost > 0 ? ((h.face - h.cost + couponsAll) / h.cost / years) * 100 : 0;

  return {
    value,
    profitSoFar: value - h.cost + couponsPaid,
    couponsPaid,
    couponsPaidCount: paid.length,
    yieldPct,
    afterTaxYieldPct: yieldPct * (1 - (h.taxPct || 0) / 100),
    termDays,
    daysLeft,
    matured,
    nextCouponDate: matured ? null : next,
    atMaturity: matured ? 0 : h.face + all.filter((d) => t(d) > t(today)).length * perCoupon,
  };
}

export type FixedIncomeEvent = { date: string; what: "coupon" | "maturity"; gross: number; tax: number };

// What a holding pays and when: each coupon after the purchase, and at
// maturity what the face value repays over the price paid (a T-bill's whole
// profit). Tax is withheld on each at the holding's rate.
export function fixedIncomeEvents(h: FixedIncomeHolding): FixedIncomeEvent[] {
  const perCoupon = h.couponsPerYear > 0 ? (h.face * (h.couponPct / 100)) / h.couponsPerYear : 0;
  const tax = (v: number) => (v > 0 ? (v * (h.taxPct || 0)) / 100 : 0);
  const out: FixedIncomeEvent[] = perCoupon > 0 ? couponDates(h, h.purchaseDate).map((date) => ({ date, what: "coupon" as const, gross: perCoupon, tax: tax(perCoupon) })) : [];
  const gain = h.face - h.cost;
  if (gain > 0) out.push({ date: h.maturityDate, what: "maturity", gross: gain, tax: tax(gain) });
  return out;
}

// The price to pay for a T-bill of a given face value at a quoted yield
// (simple, 365-day), as the auction and the banks quote it.
export function tbillCost(face: number, yieldPct: number, days: number): number {
  return face / (1 + (yieldPct / 100) * (days / 365));
}
