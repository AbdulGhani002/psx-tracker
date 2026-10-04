// Profit by financial year (July to June), dividends included, without
// counting a reinvested dividend twice.
//
// The shares are treated as their own account. Over a year:
//
//   profit = worth at the end − worth at the start − (bought − sold) + dividends
//
// Buys put money in, sales take it out, and a dividend is income the shares
// pay out. When a dividend is spent on more shares, that purchase is money
// put back in at exactly what the shares cost, so on its own it adds nothing:
// the dividend is profit once, the day it is paid, and whatever the new
// shares do afterwards is price gain. The same flows weight the year's return
// (Modified Dietz): the profit over the worth at the start plus each flow
// weighted by the part of the year it was invested for.
//
// Worth is taken at the exchange's own closing prices on the year's last
// trading day (actual prices, not the back-adjusted series), so a bonus issue
// or a split in the year needs nothing: fewer shares at the old price at one
// end, more shares at the new price at the other.

export type FyTx = {
  symbol: string;
  type: "BUY" | "SELL" | "DIVIDEND" | "BONUS" | "RIGHT" | "SPLIT";
  date: string; // yyyy-mm-dd
  shares: number; // negative for a sale
  netAmount: number; // what was paid or received, fees and tax taken off
  totalAmount?: number;
  taxDeducted?: number;
  ratio?: string; // "1:2" for a split
};

export type FyWindow = { label: string; start: string; end: string; endYear: number; current: boolean };

export type FyStock = {
  symbol: string;
  startShares: number;
  startValue: number;
  endShares: number;
  endValue: number;
  bought: number;
  sold: number;
  dividends: number;
  profit: number;
};

export type FyProfit = {
  fy: FyWindow;
  startValue: number;
  endValue: number;
  bought: number;
  sold: number;
  dividends: number;
  dividendTax: number;
  capitalGain: number; // the price part: worth at the end less the start, less what was put in net
  realized: number; // of which, gains and losses on what was sold (the CGT base)
  profit: number; // capital gain plus dividends
  returnPct: number | null; // Modified Dietz, % of the money at work
  returnShort: boolean; // no % shown: too little of the year had money at work for one to mean anything
  stocks: FyStock[];
  missingPrices: string[]; // names held at an end with no price for it (left out of the worth)
};

const DAY = 86400000;

export function fyOf(dateIso: string): number {
  const y = Number(dateIso.slice(0, 4));
  return Number(dateIso.slice(5, 7)) >= 7 ? y + 1 : y;
}

// The year ending 30 June `endYear`, cut at today when it is not over.
export function fyWindow(endYear: number, today: string): FyWindow {
  const end = `${endYear}-06-30`;
  const current = today <= end;
  return { label: `FY${String(endYear - 1).slice(2)}-${String(endYear).slice(2)}`, start: `${endYear - 1}-07-01`, end: current ? today : end, endYear, current };
}

// Shares of each name after every transaction dated on or before `date`.
export function sharesAt(txs: FyTx[], date: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of [...txs].sort((a, b) => a.date.localeCompare(b.date))) {
    if (t.date > date) break;
    const cur = out.get(t.symbol) ?? 0;
    if (t.type === "BUY" || t.type === "RIGHT" || t.type === "BONUS" || t.type === "SELL") out.set(t.symbol, cur + t.shares);
    else if (t.type === "SPLIT") {
      const [from, to] = String(t.ratio ?? "").split(":").map((s) => Number(s.trim()));
      if (from > 0 && to > 0) out.set(t.symbol, cur * (to / from));
    }
  }
  for (const [s, n] of out) if (Math.abs(n) < 1e-9) out.delete(s);
  return out;
}

const dayBefore = (iso: string) => new Date(Date.parse(iso + "T00:00:00Z") - DAY).toISOString().slice(0, 10);
const amount = (t: FyTx) => Math.abs(t.netAmount || t.totalAmount || 0);

export function fyProfit(
  txs: FyTx[],
  fy: FyWindow,
  prices: { start: (symbol: string) => number | null; end: (symbol: string) => number | null },
  realized: number
): FyProfit {
  const startShares = sharesAt(txs, dayBefore(fy.start));
  const endShares = sharesAt(txs, fy.end);
  const inYear = txs.filter((t) => t.date >= fy.start && t.date <= fy.end);
  const names = new Set([...startShares.keys(), ...endShares.keys(), ...inYear.map((t) => t.symbol)]);
  const missing = new Set<string>();
  const stocks: FyStock[] = [];
  for (const s of names) {
    const n0 = startShares.get(s) ?? 0, n1 = endShares.get(s) ?? 0;
    const mine = inYear.filter((t) => t.symbol === s);
    let p0 = n0 > 0 ? prices.start(s) : 0, p1 = n1 > 0 ? prices.end(s) : 0;
    // A missing price is taken as unchanged over the year (no gain or loss
    // invented): the other end's, else the year's own trade price.
    if (p0 == null || p1 == null) {
      missing.add(s);
      const traded = mine.filter((t) => (t.type === "BUY" || t.type === "SELL") && t.shares !== 0);
      const px = traded.length ? traded.reduce((a, t) => a + amount(t), 0) / traded.reduce((a, t) => a + Math.abs(t.shares), 0) : 0;
      if (p0 == null) p0 = p1 ?? px;
      if (p1 == null) p1 = p0 ?? px;
    }
    const bought = mine.filter((t) => t.type === "BUY" || t.type === "RIGHT").reduce((a, t) => a + amount(t), 0);
    const sold = mine.filter((t) => t.type === "SELL").reduce((a, t) => a + amount(t), 0);
    const dividends = mine.filter((t) => t.type === "DIVIDEND").reduce((a, t) => a + (t.netAmount || 0), 0);
    const startValue = n0 * (p0 ?? 0), endValue = n1 * (p1 ?? 0);
    if (n0 === 0 && n1 === 0 && mine.length === 0) continue;
    stocks.push({ symbol: s, startShares: n0, startValue, endShares: n1, endValue, bought, sold, dividends, profit: endValue - startValue - bought + sold + dividends });
  }
  stocks.sort((a, b) => b.profit - a.profit);
  const sum = (f: (x: FyStock) => number) => stocks.reduce((a, x) => a + f(x), 0);
  const startValue = sum((x) => x.startValue), endValue = sum((x) => x.endValue);
  const bought = sum((x) => x.bought), sold = sum((x) => x.sold), dividends = sum((x) => x.dividends);
  const capitalGain = endValue - startValue - bought + sold;
  const profit = capitalGain + dividends;

  // Modified Dietz: each flow counts for the part of the year after it.
  // Money in (buys) adds to the capital at work, money out (sales, and the
  // dividends the shares paid) takes from it.
  const t0 = Date.parse(fy.start + "T00:00:00Z") - DAY; // the start is the close before the year
  const T = Math.max(1, (Date.parse(fy.end + "T00:00:00Z") - t0) / DAY);
  let weighted = 0;
  for (const t of inYear) {
    const w = (Date.parse(fy.end + "T00:00:00Z") - Date.parse(t.date + "T00:00:00Z")) / DAY / T;
    if (t.type === "BUY" || t.type === "RIGHT") weighted += w * amount(t);
    else if (t.type === "SELL") weighted -= w * amount(t);
    else if (t.type === "DIVIDEND") weighted -= w * (t.netAmount || 0);
  }
  const base = startValue + weighted;
  // A year the money came in at the very end (the first, often) has almost
  // no capital at work, and a few hundred rupees of profit on it reads as a
  // triple-digit return. Below a fifth of the year's largest sum, no %.
  const scale = Math.max(startValue, endValue, bought);
  const returnShort = stocks.length > 0 && scale > 0 && base < 0.2 * scale;
  return {
    fy,
    startValue,
    endValue,
    bought,
    sold,
    dividends,
    dividendTax: inYear.filter((t) => t.type === "DIVIDEND").reduce((a, t) => a + (t.taxDeducted ?? 0), 0),
    capitalGain,
    realized,
    profit,
    returnPct: base > 0 && stocks.length > 0 && !returnShort ? (profit / base) * 100 : null,
    returnShort,
    stocks,
    missingPrices: [...missing].sort(),
  };
}
