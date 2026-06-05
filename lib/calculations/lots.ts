import type { Transaction } from "@/lib/types";

// Dated FIFO cost-basis lots. Each BUY/RIGHT opens a lot; BONUS opens a
// zero-cost lot (its acquisition date is the bonus date); SPLIT rescales open
// lots; each SELL consumes the oldest lots first, producing dated disposals
// with an exact per-disposal gain and holding period. This is what PSX CGT
// needs (holding-period tiered, acquisition-date dependent).

export type Lot = {
  acquired: string; // ISO yyyy-mm-dd
  shares: number;
  costPerShare: number;
};

export type Disposal = {
  symbol: string;
  soldDate: string;
  acquired: string;
  shares: number;
  proceedsPerShare: number;
  costPerShare: number;
  proceeds: number;
  cost: number;
  gain: number;
  holdingDays: number;
  longTerm: boolean; // held > 365 days
};

function iso(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number {
  return Math.max(
    0,
    Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000)
  );
}

export function buildLots(symbol: string, txs: Transaction[]): { openLots: Lot[]; disposals: Disposal[] } {
  const sorted = [...txs].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  const lots: Lot[] = [];
  const disposals: Disposal[] = [];

  for (const tx of sorted) {
    const date = iso(tx.date);
    const absShares = Math.abs(tx.shares);
    switch (tx.type) {
      case "BUY":
      case "RIGHT": {
        if (absShares > 0) {
          lots.push({ acquired: date, shares: absShares, costPerShare: tx.netAmount / absShares });
        }
        break;
      }
      case "BONUS": {
        if (absShares > 0) lots.push({ acquired: date, shares: absShares, costPerShare: 0 });
        break;
      }
      case "SPLIT": {
        const [from, to] = tx.ratio.split(":").map((s) => Number(s.trim()));
        if (from && to) {
          const factor = to / from;
          for (const lot of lots) {
            lot.shares *= factor;
            lot.costPerShare /= factor;
          }
        }
        break;
      }
      case "SELL": {
        let remaining = absShares;
        const proceedsPerShare = absShares > 0 ? tx.netAmount / absShares : 0;
        while (remaining > 1e-9 && lots.length > 0) {
          const lot = lots[0];
          const take = Math.min(remaining, lot.shares);
          const proceeds = take * proceedsPerShare;
          const cost = take * lot.costPerShare;
          disposals.push({
            symbol,
            soldDate: date,
            acquired: lot.acquired,
            shares: take,
            proceedsPerShare,
            costPerShare: lot.costPerShare,
            proceeds,
            cost,
            gain: proceeds - cost,
            holdingDays: daysBetween(lot.acquired, date),
            longTerm: daysBetween(lot.acquired, date) > 365,
          });
          lot.shares -= take;
          remaining -= take;
          if (lot.shares <= 1e-9) lots.shift();
        }
        break;
      }
      // DIVIDEND: no lot impact.
    }
  }

  return { openLots: lots, disposals };
}

export type CgtBracketFn = (d: { acquired: string; holdingDays: number; longTerm: boolean }) => number;

export type CgtSummary = {
  disposals: Disposal[];
  totalGain: number;
  totalLoss: number;
  netGain: number;
  shortTermGain: number;
  longTermGain: number;
  cgt: number;
  byYear: Array<{ taxYear: number; label: string; netGain: number; cgt: number; count: number }>;
};

import { taxYearOf } from "@/lib/dates";

export function summariseCgt(disposals: Disposal[], rate: number): CgtSummary {
  let totalGain = 0;
  let totalLoss = 0;
  let shortTermGain = 0;
  let longTermGain = 0;
  const yearMap = new Map<number, { taxYear: number; label: string; netGain: number; cgt: number; count: number }>();

  for (const d of disposals) {
    if (d.gain >= 0) totalGain += d.gain;
    else totalLoss += d.gain;
    if (d.longTerm) longTermGain += d.gain;
    else shortTermGain += d.gain;

    const ty = taxYearOf(d.soldDate);
    const row =
      yearMap.get(ty.endYear) ?? { taxYear: ty.endYear, label: ty.label, netGain: 0, cgt: 0, count: 0 };
    row.netGain += d.gain;
    row.count += 1;
    yearMap.set(ty.endYear, row);
  }

  const netGain = totalGain + totalLoss;
  // CGT applies to positive net gain (losses offset gains within the year).
  for (const row of yearMap.values()) {
    row.cgt = row.netGain > 0 ? (row.netGain * rate) / 100 : 0;
  }
  const cgt = [...yearMap.values()].reduce((s, r) => s + r.cgt, 0);

  return {
    disposals,
    totalGain,
    totalLoss,
    netGain,
    shortTermGain,
    longTermGain,
    cgt,
    byYear: [...yearMap.values()].sort((a, b) => b.taxYear - a.taxYear),
  };
}

// Pre-trade preview: which open lots a hypothetical sell would consume.
export function previewSell(
  openLots: Lot[],
  sellShares: number,
  pricePerShare: number,
  rate: number
): { matched: Array<{ acquired: string; shares: number; cost: number; proceeds: number; gain: number; longTerm: boolean }>; totalGain: number; estCgt: number; insufficient: boolean } {
  const lots = openLots.map((l) => ({ ...l }));
  let remaining = sellShares;
  const matched = [];
  let totalGain = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (const lot of lots) {
    if (remaining <= 1e-9) break;
    const take = Math.min(remaining, lot.shares);
    const cost = take * lot.costPerShare;
    const proceeds = take * pricePerShare;
    const gain = proceeds - cost;
    const longTerm = daysBetween(lot.acquired, today) > 365;
    matched.push({ acquired: lot.acquired, shares: take, cost, proceeds, gain, longTerm });
    totalGain += gain;
    remaining -= take;
  }
  return {
    matched,
    totalGain,
    estCgt: totalGain > 0 ? (totalGain * rate) / 100 : 0,
    insufficient: remaining > 1e-9,
  };
}
