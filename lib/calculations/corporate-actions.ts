import { deriveFromTransactions } from "@/lib/calculations/holding";
import { taxYearOf } from "@/lib/dates";

// Dividends and bonus shares recorded on their own.
//
// The exchange's payout board gives every announcement its book-closure date.
// A holder on the register the day before the closure is entitled; with T+2
// settlement that means a trade dated three business days before the closure
// or earlier. Once the closure date arrives, the job writes the DIVIDEND (or
// BONUS) row from the shares the ledger says were held then, at the rate the
// board printed, with tax at the user's filer rate. The row carries an action
// key so it is written once, and a source of "auto" so a warrant uploaded
// later replaces it instead of doubling it.

export const SETTLEMENT_DAYS = 2;
export const LOOKBACK_DAYS = 180;

export type Payout = { date: string | null; bookClosure: string | null; pctOfFace: number; cycle: string; payoutType: string };
export type SymbolPayouts = { symbol: string; faceValue: number; payouts: Payout[] };

export type AutoSettings = {
  autoDividends: boolean;
  autoBonus: boolean;
  dividendWhtPct: number;
  zakatOnDividends: "none" | "paidUp";
  bonusTaxWithheld: boolean;
  bonusTaxPct: number;
};

type Tx = { symbol: string; type: string; date: Date | string; shares: number; pricePerShare: number; netAmount: number; ratio?: string; portfolioId?: string; actionKey?: string | null; deletedAt?: Date | string | null };

export type DueAction = {
  symbol: string;
  type: "DIVIDEND" | "BONUS";
  bookClosure: string;
  pctOfFace: number;
  cycle: string;
  faceValue: number;
  portfolioId: string;
  shares: number; // shares entitled
  actionKey: string;
  // dividend
  rate: number;
  gross: number;
  tax: number;
  zakat: number;
  net: number;
  // bonus
  bonusGross: number;
  bonusWithheld: number;
  bonusCredited: number;
};

export type Skipped = { symbol: string; type: string; bookClosure: string; reason: string };

const isoDay = (d: Date | string) => (typeof d === "string" ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10));
const round2 = (v: number) => Math.round(v * 100 + 1e-9) / 100;
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// n business days before the date, Saturdays and Sundays skipped.
export function businessDaysBefore(iso: string, n: number): string {
  let d = new Date(iso + "T00:00:00Z");
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

// The last trade date that still puts the buyer on the register for a book
// closure starting on the given day.
export function lastEntitledTradeDate(bookClosureStart: string): string {
  return businessDaysBefore(bookClosureStart, 1 + SETTLEMENT_DAYS);
}

export function actionKeyOf(symbol: string, type: string, bookClosure: string, pctOfFace: number): string {
  return `${symbol}:${type}:${bookClosure}:${pctOfFace}`;
}

// Shares of one symbol held on the record date, from the ledger up to the
// last entitled trade date (bonuses, rights and splits before it included).
export function sharesEntitled(txs: Tx[], symbol: string, bookClosureStart: string): number {
  const cutoff = lastEntitledTradeDate(bookClosureStart);
  const rows = txs.filter((t) => t.symbol === symbol && !t.deletedAt && isoDay(t.date) <= cutoff);
  return Math.max(0, Math.floor(deriveFromTransactions(rows as any).shares + 1e-6));
}

export function dividendFigures(shares: number, pctOfFace: number, faceValue: number, s: AutoSettings) {
  const rate = round2((pctOfFace * faceValue) / 100);
  const gross = round2(shares * rate);
  const tax = round2((gross * s.dividendWhtPct) / 100);
  const zakat = s.zakatOnDividends === "paidUp" ? Math.min(round2(gross - tax), round2(shares * faceValue * 0.025)) : 0;
  const net = round2(gross - tax - zakat);
  return { rate, gross, tax, zakat, net };
}

export function bonusFigures(shares: number, pctOfFace: number, s: AutoSettings) {
  const gross = Math.floor((shares * pctOfFace) / 100 + 1e-9);
  const withheld = s.bonusTaxWithheld ? Math.round((gross * s.bonusTaxPct) / 100) : 0;
  return { gross, withheld, credited: Math.max(0, gross - withheld) };
}

export function financialYearLabel(iso: string): string {
  const y = taxYearOf(new Date(iso + "T00:00:00Z"));
  return `${y.startYear}-${String(y.endYear).slice(2)}`;
}

export const cycleLabel = (cycle: string) => (cycle === "F" ? "Final" : cycle ? "Interim" : "");

// A dividend already on the ledger for this closure: same name, the same rate
// per share, dated within the window a payment lands in.
function alreadyRecorded(txs: Tx[], a: { symbol: string; type: "DIVIDEND" | "BONUS"; bookClosure: string; rate: number }): boolean {
  const from = addDays(a.bookClosure, -10), to = addDays(a.bookClosure, 90);
  return txs.some((t) => {
    if (t.symbol !== a.symbol || t.type !== a.type || t.deletedAt) return false;
    const d = isoDay(t.date);
    if (d < from || d > to) return false;
    return a.type === "BONUS" || Math.abs(t.pricePerShare - a.rate) <= 0.011;
  });
}

export function planDueActions(input: {
  liveTxs: Tx[];
  usedKeys: Set<string>; // action keys ever written, trashed rows included
  boards: SymbolPayouts[];
  settings: AutoSettings;
  defaultPortfolioId: string;
  today: string;
  lookbackDays?: number;
}): { due: DueAction[]; skipped: Skipped[] } {
  const { liveTxs, usedKeys, boards, settings, defaultPortfolioId, today } = input;
  const lookback = input.lookbackDays ?? LOOKBACK_DAYS;
  const from = addDays(today, -lookback);
  const due: DueAction[] = [];
  const skipped: Skipped[] = [];
  const canon = (p?: string) => (p && p !== defaultPortfolioId ? p : defaultPortfolioId);

  for (const b of boards) {
    const byPortfolio = new Map<string, Tx[]>();
    for (const t of liveTxs) {
      if (t.symbol !== b.symbol) continue;
      const k = canon(t.portfolioId);
      (byPortfolio.get(k) ?? byPortfolio.set(k, []).get(k)!).push(t);
    }
    for (const p of b.payouts) {
      const bc = p.bookClosure;
      const type = p.payoutType === "cash" ? "DIVIDEND" : p.payoutType === "bonus" ? "BONUS" : null;
      if (!type || !bc || !(p.pctOfFace > 0)) continue;
      if (bc > today || bc < from) continue;
      if (type === "DIVIDEND" && !settings.autoDividends) continue;
      if (type === "BONUS" && !settings.autoBonus) continue;
      const key = actionKeyOf(b.symbol, type, bc, p.pctOfFace);
      if (usedKeys.has(key)) continue;
      const rate = round2((p.pctOfFace * b.faceValue) / 100);
      if (alreadyRecorded(liveTxs, { symbol: b.symbol, type, bookClosure: bc, rate })) {
        skipped.push({ symbol: b.symbol, type, bookClosure: bc, reason: "already on the ledger" });
        continue;
      }
      let any = false;
      for (const [portfolioId, txs] of byPortfolio) {
        const shares = sharesEntitled(txs, b.symbol, bc);
        if (shares <= 0) continue;
        any = true;
        const d = type === "DIVIDEND" ? dividendFigures(shares, p.pctOfFace, b.faceValue, settings) : { rate: 0, gross: 0, tax: 0, zakat: 0, net: 0 };
        const bo = type === "BONUS" ? bonusFigures(shares, p.pctOfFace, settings) : { gross: 0, withheld: 0, credited: 0 };
        if (type === "BONUS" && bo.credited <= 0) continue;
        due.push({ symbol: b.symbol, type, bookClosure: bc, pctOfFace: p.pctOfFace, cycle: p.cycle ?? "", faceValue: b.faceValue, portfolioId, shares, actionKey: key, ...d, bonusGross: bo.gross, bonusWithheld: bo.withheld, bonusCredited: bo.credited });
      }
      if (!any) skipped.push({ symbol: b.symbol, type, bookClosure: bc, reason: "no shares held on the record date" });
    }
  }
  due.sort((a, b) => a.bookClosure.localeCompare(b.bookClosure) || a.symbol.localeCompare(b.symbol));
  return { due, skipped };
}

export function autoSettingsFrom(s: any): AutoSettings {
  const filer = (s?.filerStatus ?? "filer") !== "non-filer";
  return {
    autoDividends: s?.autoDividends ?? true,
    autoBonus: s?.autoBonus ?? true,
    dividendWhtPct: filer ? s?.dividendWhtFiler ?? 15 : s?.dividendWhtNonFiler ?? 30,
    zakatOnDividends: s?.zakatOnDividends === "paidUp" ? "paidUp" : "none",
    bonusTaxWithheld: s?.bonusTaxWithheld ?? true,
    bonusTaxPct: filer ? s?.bonusTaxFiler ?? 10 : s?.bonusTaxNonFiler ?? 20,
  };
}

const fmtDate = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function describeAction(a: DueAction): string {
  if (a.type === "DIVIDEND") {
    return `${a.symbol} ${cycleLabel(a.cycle).toLowerCase() || "cash"} dividend Rs ${a.rate.toFixed(2)} x ${a.shares.toLocaleString()} = Rs ${a.gross.toLocaleString()} gross, Rs ${a.net.toLocaleString()} net (book closure ${fmtDate(a.bookClosure)})`;
  }
  return `${a.symbol} bonus ${a.pctOfFace}%: ${a.bonusCredited.toLocaleString()} shares credited${a.bonusWithheld > 0 ? `, ${a.bonusWithheld} withheld for tax` : ""} (book closure ${fmtDate(a.bookClosure)})`;
}
