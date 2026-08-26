import type { Transaction } from "@/lib/types";
import { buildLots } from "./lots";

export type ImpliedTopUp = { date: string; amount: number; reason: string };

export type CashSummary = {
  balance: number;
  deposits: number;
  withdrawals: number;
  dividendsCollected: number;
  proceedsFromSells: number;
  spentOnBuys: number;
  // Money the ledger never recorded but the trades prove arrived. See below.
  impliedDeposits: number;
  topUps: ImpliedTopUp[];
  // CGT held back out of sale proceeds so it is never planned as spendable.
  cgtWithheld: number;
};

// CGT is charged on the REALISED GAIN, never on the proceeds, and a loss is not
// taxed at all. Gains are matched FIFO, which is the basis the tax is actually
// assessed on (holdings run on average cost — the two disagree by design).
//
// NCCPL collects this later, not at settlement, so the broker really does credit
// the full proceeds on the day. Holding it back anyway is deliberate: the number
// this file feeds is "cash I can deploy", and money already owed to the FBR is
// not that. Withheld tax is reported separately so the full proceeds are still
// visible.
function cgtBySellDate(transactions: Transaction[], ratePct: number): Map<string, number> {
  const out = new Map<string, number>();
  if (!(ratePct > 0)) return out;
  const bySymbol = new Map<string, Transaction[]>();
  for (const t of transactions) {
    const sym = String((t as { symbol?: unknown }).symbol ?? "");
    if (!sym) continue;
    const list = bySymbol.get(sym);
    list ? list.push(t) : bySymbol.set(sym, [t]);
  }
  for (const [symbol, txs] of bySymbol) {
    let disposals: ReturnType<typeof buildLots>["disposals"] = [];
    try {
      disposals = buildLots(symbol, txs).disposals;
    } catch {
      continue; // an unmatched sell must not take the whole balance down with it
    }
    for (const d of disposals) {
      if (!(d.gain > 0)) continue; // a loss is not taxed
      const key = `${symbol}|${d.soldDate}`;
      out.set(key, (out.get(key) ?? 0) + (d.gain * ratePct) / 100);
    }
  }
  return out;
}

type CashEntryLike = { type: "DEPOSIT" | "WITHDRAWAL"; amount: number; date?: unknown };

function timeOf(d: unknown): number {
  if (d instanceof Date) return d.getTime();
  const t = new Date(String(d ?? "")).getTime();
  return Number.isFinite(t) ? t : 0;
}

function isoOf(d: unknown): string {
  const t = timeOf(d);
  return t ? new Date(t).toISOString().slice(0, 10) : "";
}

// Cash is implied from the book: deposits + sells + dividends - buys - withdrawals.
// Buys and rights subtract netAmount (fees included); sells and dividends add it.
//
// This book was rebuilt from an NCCPL tax certificate, which carries every trade
// but no cash movements — so the deposit ledger is knowingly incomplete while the
// trade ledger is not. A raw walk therefore goes negative, and a negative
// brokerage balance is not a fact about the world: you cannot buy shares with
// money you do not have. Where the balance would go under, the missing side of
// the entry is a deposit nobody wrote down.
//
// So the walk runs in date order and, the moment it would dip below zero, books
// an implied top-up for exactly the shortfall. Cash can rest at zero; it can
// never be negative. Each top-up is kept with its date and reason rather than
// folded into the total, because "we assumed money arrived here" is a claim the
// owner has to be able to see and check against a bank statement.
//
// Same-day ordering puts credits before debits: funding a purchase on the day
// you make it is the ordinary case, and assuming otherwise invents a top-up that
// the very next row cancels.
export function computeCashBalance(
  transactions: Transaction[],
  cashEntries: CashEntryLike[],
  opts: { cgtRatePct?: number } = {}
): CashSummary {
  const cgtRatePct = opts.cgtRatePct ?? 15;
  let deposits = 0;
  let withdrawals = 0;
  let spentOnBuys = 0;
  let proceedsFromSells = 0;
  let dividendsCollected = 0;
  let cgtWithheld = 0;

  // A day's tax lands on that day's sale. Where one symbol was sold on more than
  // one ticket the same day, split it by share count so no ticket is taxed twice.
  const cgtDue = cgtBySellDate(transactions, cgtRatePct);
  const soldSharesByKey = new Map<string, number>();
  for (const t of transactions) {
    if (t.type !== "SELL") continue;
    const key = `${String((t as { symbol?: unknown }).symbol ?? "")}|${isoOf((t as { date?: unknown }).date)}`;
    soldSharesByKey.set(key, (soldSharesByKey.get(key) ?? 0) + Math.abs(Number(t.shares) || 0));
  }

  type Event = { t: number; credit: boolean; delta: number; date: string };
  const events: Event[] = [];

  for (const e of cashEntries) {
    const amount = Number(e.amount) || 0;
    const credit = e.type === "DEPOSIT";
    if (credit) deposits += amount;
    else withdrawals += amount;
    events.push({ t: timeOf(e.date), credit, delta: credit ? amount : -amount, date: isoOf(e.date) });
  }

  for (const tx of transactions) {
    const net = Number(tx.netAmount) || 0;
    let delta = 0;
    if (tx.type === "BUY" || tx.type === "RIGHT") {
      spentOnBuys += net;
      delta = -net;
    } else if (tx.type === "SELL") {
      proceedsFromSells += net;
      const key = `${String((tx as { symbol?: unknown }).symbol ?? "")}|${isoOf((tx as { date?: unknown }).date)}`;
      const dayTax = cgtDue.get(key) ?? 0;
      const daySold = soldSharesByKey.get(key) ?? 0;
      const mine = Math.abs(Number(tx.shares) || 0);
      const tax = daySold > 0 ? (dayTax * mine) / daySold : dayTax;
      // Never let tax exceed the proceeds — that would turn a sale into a debit.
      const withheld = Math.min(Math.max(0, tax), Math.max(0, net));
      cgtWithheld += withheld;
      delta = net - withheld;
    } else if (tx.type === "DIVIDEND") {
      dividendsCollected += net;
      delta = net;
    } else {
      continue; // BONUS and SPLIT move shares, not money
    }
    events.push({ t: timeOf((tx as { date?: unknown }).date), credit: delta > 0, delta, date: isoOf((tx as { date?: unknown }).date) });
  }

  events.sort((a, b) => a.t - b.t || Number(b.credit) - Number(a.credit));

  let balance = 0;
  let impliedDeposits = 0;
  const topUps: ImpliedTopUp[] = [];
  for (const e of events) {
    balance += e.delta;
    if (balance < -0.005) {
      const short = -balance;
      impliedDeposits += short;
      topUps.push({
        date: e.date,
        amount: Number(short.toFixed(2)),
        reason: "spend exceeded recorded cash — deposit not in the ledger",
      });
      balance = 0;
    }
  }

  return {
    balance: Math.max(0, Number(balance.toFixed(2))),
    deposits,
    withdrawals,
    dividendsCollected,
    proceedsFromSells,
    spentOnBuys,
    impliedDeposits: Number(impliedDeposits.toFixed(2)),
    topUps,
    cgtWithheld: Number(cgtWithheld.toFixed(2)),
  };
}
