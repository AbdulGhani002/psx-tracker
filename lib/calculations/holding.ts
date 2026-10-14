import type { Transaction } from "@/lib/types";

export type HoldingDerived = {
  shares: number;
  totalCost: number;
  avgCost: number;
  realizedPL: number;
  dividendsReceived: number;
};

function applySplit(state: HoldingDerived, ratio: string) {
  const [from, to] = ratio.split(":").map((s) => Number(s.trim()));
  if (!from || !to) return;
  const factor = to / from;
  state.shares *= factor;
}

// One transaction applied to a position: average cost, so a sale takes out
// its share of the cost and books the rest as realised.
function step(s: HoldingDerived, tx: Transaction) {
  switch (tx.type) {
    case "BUY": {
      s.shares += tx.shares;
      s.totalCost += tx.netAmount;
      s.avgCost = s.shares > 0 ? s.totalCost / s.shares : 0;
      break;
    }
    case "SELL": {
      const sellShares = Math.abs(tx.shares);
      if (s.shares <= 0 || sellShares <= 0) break;
      const proportion = Math.min(1, sellShares / s.shares);
      const costRemoved = s.totalCost * proportion;
      s.realizedPL += tx.netAmount - costRemoved;
      s.totalCost -= costRemoved;
      s.shares -= sellShares;
      s.avgCost = s.shares > 0 ? s.totalCost / s.shares : 0;
      break;
    }
    case "DIVIDEND": {
      s.dividendsReceived += tx.netAmount;
      break;
    }
    case "BONUS": {
      s.shares += tx.shares;
      s.avgCost = s.shares > 0 ? s.totalCost / s.shares : 0;
      break;
    }
    case "RIGHT": {
      s.shares += tx.shares;
      s.totalCost += tx.netAmount;
      s.avgCost = s.shares > 0 ? s.totalCost / s.shares : 0;
      break;
    }
    case "SPLIT": {
      applySplit(s, tx.ratio);
      s.avgCost = s.shares > 0 ? s.totalCost / s.shares : 0;
      break;
    }
  }
}

const byDate = (a: Transaction, b: Transaction) => new Date(a.date).getTime() - new Date(b.date).getTime();
const empty = (): HoldingDerived => ({ shares: 0, totalCost: 0, avgCost: 0, realizedPL: 0, dividendsReceived: 0 });

export function deriveFromTransactions(txs: Transaction[]): HoldingDerived {
  const s = empty();
  for (const tx of [...txs].sort(byDate)) step(s, tx);
  return s;
}

// The money a holding had at work: what the shares held at the time cost,
// day by day, from the first trade to `asOf`. Returns and yields are measured
// on it, so a position mostly sold does not divide what the larger position
// earned by what the shares left cost, and money put in last week does not
// count as a year's.
export type MoneyAtWork = {
  daysHeld: number; // days with shares held
  average: number; // the cost of the shares held, averaged over those days
  average12m: number; // averaged over the last 365 days, a day with none held counting as nothing
  dividends12m: number; // received in the last 365 days
};

const DAY = 86400000;
const dayOf = (d: Date | string) => Math.floor(new Date(d).getTime() / DAY);

export function moneyAtWork(txs: Transaction[], asOf: Date = new Date()): MoneyAtWork {
  const end = dayOf(asOf);
  const from = end - 365;
  const s = empty();
  let last: number | null = null;
  let costDays = 0, held = 0, costDays12m = 0, dividends12m = 0;
  // The days since the last trade, at the cost held through them.
  const accrue = (to: number) => {
    if (last == null || to <= last || s.shares <= 0) return;
    costDays += s.totalCost * (to - last);
    held += to - last;
    const a = Math.max(last, from), b = Math.min(to, end);
    if (b > a) costDays12m += s.totalCost * (b - a);
  };
  for (const tx of [...txs].sort(byDate)) {
    const d = dayOf(tx.date);
    if (d > end) break;
    accrue(d);
    last = last == null ? d : Math.max(last, d);
    step(s, tx);
    if (tx.type === "DIVIDEND" && d > from) dividends12m += tx.netAmount;
  }
  accrue(end);
  return { daysHeld: held, average: held > 0 ? costDays / held : 0, average12m: costDays12m / 365, dividends12m };
}

// The shares held now and the shares sold, each with what they cost and the
// dividends they earned: a dividend follows the shares it was paid on, so
// when shares are sold their dividends go with them, and a dividend paid on
// more shares than are left (book closure before a sale, payment after) is
// split the same way. So the shares left are credited only with what they
// earned, and a sale's loss is set against the dividends of the shares sold.
// Average cost, as the rest of the app keeps it. `unit` converts a
// transaction's rupees, e.g. into dollars at its day's rate.
export type HeldSold = {
  held: { shares: number; cost: number; dividends: number; dividends12m: number };
  sold: { shares: number; cost: number; proceeds: number; dividends: number };
};

export function heldAndSold(txs: Transaction[], asOf: Date = new Date(), unit: (tx: Transaction) => number = () => 1): HeldSold {
  const end = dayOf(asOf);
  const from = end - 365;
  let shares = 0, cost = 0;
  let earned: Array<{ day: number; amount: number }> = []; // dividends on the shares held
  const sold = { shares: 0, cost: 0, proceeds: 0, dividends: 0 };
  for (const tx of [...txs].sort(byDate)) {
    const d = dayOf(tx.date);
    if (d > end) break;
    const amount = tx.netAmount * unit(tx);
    switch (tx.type) {
      case "BUY":
      case "RIGHT":
        shares += tx.shares;
        cost += amount;
        break;
      case "BONUS":
        shares += tx.shares;
        break;
      case "SPLIT": {
        const [a, b] = String(tx.ratio ?? "").split(":").map((x) => Number(x.trim()));
        if (a && b) shares *= b / a;
        break;
      }
      case "SELL": {
        const n = Math.min(Math.abs(tx.shares), shares);
        if (shares <= 0 || n <= 0) break;
        const f = n / shares;
        sold.shares += n;
        sold.cost += cost * f;
        sold.proceeds += amount;
        sold.dividends += earned.reduce((t, x) => t + x.amount, 0) * f;
        earned = earned.map((x) => ({ ...x, amount: x.amount * (1 - f) }));
        cost *= 1 - f;
        shares -= n;
        break;
      }
      case "DIVIDEND": {
        const entitled = tx.shares > 0 ? tx.shares : shares;
        const onHeld = entitled > 0 ? amount * Math.min(1, shares / entitled) : 0;
        sold.dividends += amount - onHeld;
        if (onHeld > 0) earned.push({ day: d, amount: onHeld });
        break;
      }
    }
  }
  return {
    held: { shares, cost, dividends: earned.reduce((t, x) => t + x.amount, 0), dividends12m: earned.filter((x) => x.day > from).reduce((t, x) => t + x.amount, 0) },
    sold,
  };
}

// Dividends received within the Pakistan tax year (Jul–Jun) containing `ref`.
import { inSameTaxYear } from "@/lib/dates";
export function dividendsYTD(txs: Transaction[], ref: Date = new Date()): number {
  return txs
    .filter((t) => t.type === "DIVIDEND" && inSameTaxYear(new Date(t.date), ref))
    .reduce((sum, t) => sum + t.netAmount, 0);
}

export function yieldOnCost(annualDivPerShare: number, avgCost: number): number {
  if (avgCost <= 0) return 0;
  return annualDivPerShare / avgCost;
}
