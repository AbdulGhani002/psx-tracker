// The money coming in over the next days and what the price rules would ask
// for. Dividends from book closures already known, paid into the bank about
// three weeks after the book closure; each coupon and maturity of the
// T-bills, sukuks and deposits held; and each price rule's next add, were
// its price reached. Pure, so scripts/test-cash-calendar.ts runs it.

export const PAY_LAG_DAYS = 21;
const DAY = 86400000;
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
const r0 = (v: number) => Math.round(v);

export type CalItem = { date: string; label: string; kind: "dividend" | "coupon" | "maturity"; pkr: number; about: boolean; claim: "receivable" | "expected" };
export type CalNeed = { symbol: string; move: number; price: number; qty: number; pkr: number };
export type CashCalendar = { today: string; until: string; cashNow: number; items: CalItem[]; in30: number; in60: number; in90: number; needs: CalNeed[]; needsTotal: number; shortBy: number };

export const dividendPayDay = (bookClosure: string) => addDays(bookClosure, PAY_LAG_DAYS);

// Each cash payout of a share held. One whose books have closed is owed on
// the shares held then (the dividend recorded for it); one still to close is
// expected on the shares held now. One paid already (a dividend entered on
// or after its book closure that the job did not write) is left out.
export function dividendItems(i: {
  today: string;
  days: number;
  taxPct: number;
  held: Array<{ symbol: string; shares: number }>;
  payouts: Array<{ symbol: string; bookClosure: string; pctOfFace: number; face: number; cycle: string }>;
  recorded: Array<{ symbol: string; date: string; net: number; auto: boolean }>;
}): CalItem[] {
  const until = addDays(i.today, i.days);
  const shares = new Map(i.held.map((h) => [h.symbol, h.shares]));
  const out: CalItem[] = [];
  for (const p of i.payouts) {
    const pay = dividendPayDay(p.bookClosure);
    if (pay <= i.today || pay > until || !(p.pctOfFace > 0)) continue;
    const own = i.recorded.filter((r) => r.symbol === p.symbol && r.date >= p.bookClosure && r.date <= addDays(p.bookClosure, 60));
    if (own.some((r) => !r.auto)) continue;
    const kind = p.cycle === "F" ? "final" : p.cycle ? "interim" : "";
    const label = `${p.symbol} ${kind ? kind + " " : ""}dividend`;
    if (p.bookClosure <= i.today) {
      const rec = own.find((r) => r.auto);
      const n = shares.get(p.symbol) ?? 0;
      const pkr = rec ? rec.net : p.bookClosure === i.today && n > 0 ? n * ((p.pctOfFace * p.face) / 100) * (1 - i.taxPct / 100) : 0;
      if (pkr >= 1) out.push({ date: pay, label, kind: "dividend", pkr: r0(pkr), about: true, claim: "receivable" });
    } else {
      const n = shares.get(p.symbol) ?? 0;
      if (n > 0) out.push({ date: pay, label, kind: "dividend", pkr: r0(n * ((p.pctOfFace * p.face) / 100) * (1 - i.taxPct / 100)), about: true, claim: "expected" });
    }
  }
  return out;
}

// Coupons, after tax, and maturities: the face value repaid less the tax on
// the profit (a T-bill's discount, a deposit's profit at maturity).
export function fixedItems(i: {
  today: string;
  days: number;
  holdings: Array<{ name: string; face: number; events: Array<{ date: string; what: "coupon" | "maturity"; gross: number; tax: number }>; maturityDate: string }>;
}): CalItem[] {
  const until = addDays(i.today, i.days);
  const out: CalItem[] = [];
  for (const h of i.holdings) {
    for (const e of h.events) {
      if (e.date <= i.today || e.date > until) continue;
      if (e.what === "coupon") out.push({ date: e.date, label: `${h.name} coupon`, kind: "coupon", pkr: r0(e.gross - e.tax), about: false, claim: "receivable" });
    }
    if (h.maturityDate > i.today && h.maturityDate <= until) {
      const tax = h.events.filter((e) => e.what === "maturity").reduce((s, e) => s + e.tax, 0);
      out.push({ date: h.maturityDate, label: `${h.name} matures`, kind: "maturity", pkr: r0(h.face - tax), about: false, claim: "receivable" });
    }
  }
  return out;
}

// Each price rule's next add: its share of the shares held, at its price.
export function ruleNeeds(shares: Array<{ symbol: string; shares: number; nextAdd: { move: number; sizePct: number; price: number } | null; off?: boolean; addsOff?: boolean }>): CalNeed[] {
  return shares.flatMap((s) => {
    if (!s.nextAdd || s.off || s.addsOff || !(s.shares > 0) || !(s.nextAdd.sizePct > 0)) return [];
    const qty = Math.max(1, Math.round((s.shares * s.nextAdd.sizePct) / 100));
    return [{ symbol: s.symbol, move: s.nextAdd.move, price: s.nextAdd.price, qty, pkr: r0(qty * s.nextAdd.price) }];
  });
}

export function buildCashCalendar(i: { today: string; days?: number; cashNow: number; items: CalItem[]; needs: CalNeed[] }): CashCalendar {
  const days = i.days ?? 90;
  const until = addDays(i.today, days);
  const items = i.items.filter((x) => x.date > i.today && x.date <= until && x.pkr >= 1).sort((a, b) => a.date.localeCompare(b.date) || b.pkr - a.pkr);
  const upTo = (n: number) => items.filter((x) => x.date <= addDays(i.today, n)).reduce((s, x) => s + x.pkr, 0);
  const needs = [...i.needs].sort((a, b) => b.move - a.move);
  const needsTotal = needs.reduce((s, n) => s + n.pkr, 0);
  return { today: i.today, until, cashNow: r0(i.cashNow), items, in30: upTo(30), in60: upTo(60), in90: upTo(days), needs, needsTotal, shortBy: Math.max(0, needsTotal - r0(i.cashNow) - upTo(days)) };
}
