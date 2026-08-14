// Financial-year roll-up for PMEX commodity, index and currency contracts.
//
// Pure: every input is passed in, nothing is fetched. The page and the wealth
// reconciliation both read from here so one definition of "this year's PMEX
// profit" exists rather than two that drift.
//
// Two deliberate accounting choices, because futures are not shares:
//  * REALISED belongs to the financial year the contract was CLOSED in (exit
//    date), not the year it was opened. A gold contract opened in May 2025 and
//    closed in August 2025 is FY2026 profit.
//  * A contract you still hold contributes only its mark-to-market, and only
//    when it actually carries a mark. An unmarked open contract is reported
//    separately instead of being silently valued at entry (which would print a
//    confident 0.00 profit that is really "we don't know").

import { valueTrade, expiryStatus, type CommodityTradeInput, type ExpiryState } from "./pmex";

export type PmexTrade = CommodityTradeInput & {
  symbol: string;
  entryDate: string; // yyyy-mm-dd
  exitDate: string | null;
  expiryDate?: string | null;
  contractType?: string;
};

export type FyWindow = { label: string; start: string; end: string; endYear: number };

// Pakistan's financial year: 1 July .. 30 June, named by the year it ends in.
export function fyWindow(endYear: number): FyWindow {
  return {
    label: `FY${endYear}`,
    start: `${endYear - 1}-07-01`,
    end: `${endYear}-06-30`,
    endYear,
  };
}

// The financial year a date falls in. July onwards belongs to the NEXT FY.
export function financialYearOf(iso: string): FyWindow {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return fyWindow(m >= 7 ? y + 1 : y);
}

function inWindow(iso: string | null, w: FyWindow): boolean {
  return !!iso && iso >= w.start && iso <= w.end;
}

export type InstrumentRow = {
  symbol: string;
  closedTrades: number;
  openTrades: number;
  realisedNet: number;
  openNet: number;
  net: number;
};

export type PmexSummary = {
  fy: FyWindow;
  realised: {
    trades: number;
    gross: number;
    commission: number;
    net: number;
    cgt: number;
    netAfterTax: number;
  };
  open: {
    trades: number;
    exposure: number;
    net: number; // mark-to-market on marked contracts only
    unmarked: number; // contracts held with no mark — excluded from `net`
    marginPosted: number; // cash tied up holding the open book
    leverage: number | null; // exposure / margin, null when no margin recorded
    noExpiryRecorded: number; // open contracts with no expiry date entered
  };
  // Open contracts that need a decision before the exchange makes it for you,
  // most urgent first.
  attention: Array<{
    symbol: string;
    state: ExpiryState;
    daysToExpiry: number | null;
    deliveryRisk: boolean;
    expiryDate: string | null;
  }>;
  byInstrument: InstrumentRow[];
  stats: {
    wins: number;
    losses: number;
    winRatePct: number | null;
    avgWin: number | null;
    avgLoss: number | null; // negative
    profitFactor: number | null; // gross wins / gross losses
    expectancy: number | null; // average net per closed contract
    bestNet: number | null;
    worstNet: number | null;
    avgHoldDays: number | null;
  };
};

function daysBetween(a: string, b: string): number {
  const ms = new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

export function summarisePmex(
  trades: PmexTrade[],
  commissionPerLot: number,
  cgtPercent: number,
  fy: FyWindow,
  todayIso = new Date().toISOString().slice(0, 10)
): PmexSummary {
  const realised = { trades: 0, gross: 0, commission: 0, net: 0, cgt: 0, netAfterTax: 0 };
  const open = {
    trades: 0,
    exposure: 0,
    net: 0,
    unmarked: 0,
    marginPosted: 0,
    leverage: null as number | null,
    noExpiryRecorded: 0,
  };
  const attention: PmexSummary["attention"] = [];
  const byId = new Map<string, InstrumentRow>();
  const row = (sym: string): InstrumentRow => {
    let r = byId.get(sym);
    if (!r) {
      r = { symbol: sym, closedTrades: 0, openTrades: 0, realisedNet: 0, openNet: 0, net: 0 };
      byId.set(sym, r);
    }
    return r;
  };

  const closedNets: number[] = [];
  const holdDays: number[] = [];

  for (const t of trades) {
    const v = valueTrade(t, commissionPerLot, cgtPercent);
    const r = row(t.symbol);

    if (!v.isOpen) {
      // Closed contracts count towards the year they were closed in.
      if (!inWindow(t.exitDate, fy)) continue;
      realised.trades++;
      realised.gross += v.grossPL;
      realised.commission += v.commission;
      realised.net += v.netPL;
      realised.cgt += v.cgt;
      realised.netAfterTax += v.netAfterTax;
      r.closedTrades++;
      r.realisedNet += v.netPL;
      closedNets.push(v.netPL);
      if (t.exitDate) holdDays.push(daysBetween(t.entryDate, t.exitDate));
      continue;
    }

    // Still held. Contracts opened after the window ends are not this year's.
    if (t.entryDate > fy.end) continue;
    open.trades++;
    open.exposure += v.exposure;
    open.marginPosted += t.marginPosted ?? 0;
    r.openTrades++;
    if (t.currentPrice == null) {
      open.unmarked++;
    } else {
      open.net += v.netPL;
      r.openNet += v.netPL;
    }

    const ex = expiryStatus(t, todayIso);
    if (!t.expiryDate) open.noExpiryRecorded++;
    if (ex.state === "near" || ex.state === "expired") {
      attention.push({
        symbol: t.symbol,
        state: ex.state,
        daysToExpiry: ex.daysToExpiry,
        deliveryRisk: ex.deliveryRisk,
        expiryDate: t.expiryDate ?? null,
      });
    }
  }
  open.leverage = open.marginPosted > 0 ? open.exposure / open.marginPosted : null;
  // Already expired first, then soonest. A contract past expiry on a
  // deliverable line is the one that can actually hand you a commodity.
  attention.sort((a, b) => (a.daysToExpiry ?? 0) - (b.daysToExpiry ?? 0));

  const wins = closedNets.filter((n) => n > 0);
  const losses = closedNets.filter((n) => n < 0);
  const grossWin = wins.reduce((s, n) => s + n, 0);
  const grossLoss = Math.abs(losses.reduce((s, n) => s + n, 0));
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, n) => s + n, 0) / xs.length : null);

  const byInstrument = [...byId.values()]
    .map((r) => ({ ...r, net: r.realisedNet + r.openNet }))
    .filter((r) => r.closedTrades > 0 || r.openTrades > 0)
    .sort((a, b) => b.net - a.net);

  return {
    fy,
    realised,
    open,
    attention,
    byInstrument,
    stats: {
      wins: wins.length,
      losses: losses.length,
      winRatePct: closedNets.length ? (wins.length / closedNets.length) * 100 : null,
      avgWin: avg(wins),
      avgLoss: avg(losses),
      // Undefined rather than Infinity when nothing was lost — a profit factor
      // of Infinity reads as a bug, and "no losing contracts" is the honest
      // statement.
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
      expectancy: avg(closedNets),
      bestNet: closedNets.length ? Math.max(...closedNets) : null,
      worstNet: closedNets.length ? Math.min(...closedNets) : null,
      avgHoldDays: avg(holdDays),
    },
  };
}

// Every financial year the book has activity in, newest first. Used to offer
// year-over-year comparison without inventing empty years.
export function activeFinancialYears(trades: PmexTrade[]): FyWindow[] {
  const years = new Set<number>();
  for (const t of trades) {
    years.add(financialYearOf(t.entryDate).endYear);
    if (t.exitDate) years.add(financialYearOf(t.exitDate).endYear);
  }
  return [...years].sort((a, b) => b - a).map(fyWindow);
}
