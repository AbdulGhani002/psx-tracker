import type { Transaction } from "@/lib/types";

export type CashSummary = {
  balance: number;
  deposits: number;
  withdrawals: number;
  dividendsCollected: number;
  proceedsFromSells: number;
  spentOnBuys: number;
};

type CashEntryLike = { type: "DEPOSIT" | "WITHDRAWAL"; amount: number };

// Cash balance is implied:
//   deposits + sells + dividends - buys - rights - withdrawals
// Buys and rights subtract netAmount (which includes fees).
// Sells and dividends add netAmount (which is post-fees).
export function computeCashBalance(
  transactions: Transaction[],
  cashEntries: CashEntryLike[]
): CashSummary {
  let deposits = 0;
  let withdrawals = 0;
  for (const e of cashEntries) {
    if (e.type === "DEPOSIT") deposits += e.amount;
    else withdrawals += e.amount;
  }

  let spentOnBuys = 0;
  let proceedsFromSells = 0;
  let dividendsCollected = 0;
  for (const t of transactions) {
    if (t.type === "BUY" || t.type === "RIGHT") spentOnBuys += t.netAmount;
    else if (t.type === "SELL") proceedsFromSells += t.netAmount;
    else if (t.type === "DIVIDEND") dividendsCollected += t.netAmount;
  }

  const balance =
    deposits + proceedsFromSells + dividendsCollected - spentOnBuys - withdrawals;

  return {
    balance,
    deposits,
    withdrawals,
    dividendsCollected,
    proceedsFromSells,
    spentOnBuys,
  };
}
