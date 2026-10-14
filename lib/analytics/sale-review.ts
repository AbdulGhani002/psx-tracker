// Sale review: what the shares of each sale would be worth today had they
// been kept, so you see whether selling helped. Pure, so
// scripts/test-sale-review.ts runs it.
//   Worth now = what the sale fetched before fees, moved by the share's
//   price since that day (the back-adjusted closes, so a bonus or split in
//   between counts), plus the cash dividends those shares would have been
//   paid since, after tax. Against what the sale brought in, after fees.

import { closeOn, type Close } from "./fy-extra";

export type Sale = { id: string; symbol: string; date: string; shares: number; price: number; proceeds: number };
export type Payout = { bookClosure: string; dps: number };
export type SaleReview = Sale & { priceNow: number | null; changePct: number | null; worthNow: number | null; dividends: number; diff: number | null };

// A dividend whose book closure is more than two trading days after the
// sale was the buyer's: the shares sold would have been paid it.
const DAY = 86400000;
const after = (bookClosure: string, sale: string) => Date.parse(bookClosure + "T00:00:00Z") - Date.parse(sale + "T00:00:00Z") > 3 * DAY;

export function reviewSale(sale: Sale, closes: Close[], latest: { date: string; close: number } | null, payouts: Payout[], taxPct: number): SaleReview {
  const then = closeOn(closes, sale.date);
  const last = closes.length ? closes[closes.length - 1] : null;
  // The price change since the sale: on the adjusted series where it has the
  // day, otherwise the latest close against the sale price.
  const ratio = then != null && last != null && last.date > sale.date ? last.close / then : latest && latest.date > sale.date ? latest.close / sale.price : null;
  const priceNow = latest?.close ?? last?.close ?? null;
  const dividends = payouts.filter((p) => p.dps > 0 && after(p.bookClosure, sale.date) && (!latest || p.bookClosure <= latest.date)).reduce((s, p) => s + p.dps * sale.shares * (1 - taxPct / 100), 0);
  const worthNow = ratio != null ? sale.shares * sale.price * ratio : null;
  return { ...sale, priceNow, changePct: ratio != null ? (ratio - 1) * 100 : null, worthNow, dividends, diff: worthNow != null ? sale.proceeds - (worthNow + dividends) : null };
}
