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

export function deriveFromTransactions(txs: Transaction[]): HoldingDerived {
  const sorted = [...txs].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const s: HoldingDerived = {
    shares: 0,
    totalCost: 0,
    avgCost: 0,
    realizedPL: 0,
    dividendsReceived: 0,
  };

  for (const tx of sorted) {
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

  return s;
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
