// The swing book the Swing trades page shows: trades that are opened once and
// then left alone. Each evening after the close it is moved on by one step:
//
//   1. a buy signalled the evening before fills at today's close, and gets its
//      stop, its target and its sell-by date, fixed from that price;
//   2. an open trade closes on the first close at or under its stop, at or
//      over its target, or on its sell-by date at whatever the close is;
//   3. if a slot is free and the market is strong, the best-ranked names not
//      in the book (and not sold in the last two weeks) are signalled, to be
//      bought at the next close.
//
// Nothing else changes a trade: not a new rank, not a new day's levels. The
// rule and the functions are the ones swingBookBacktest ran over 24 years
// (swing.ts), so the page's tested record is the record of this book.

import { loadQuantSnapshot, saveQuantSnapshot } from "./store";
import { loadStoredBars } from "./sheet-bars";
import { SWING_BOOK_RULE, sigmaHAt, stepTrade, pickTrades, newTrade, sessionsBetween, type BookRule, type BookTrade, type BookCandidate } from "./swing";
import type { MarketRead } from "./analysis";

export type SwingBook = {
  version: 1;
  rule: BookRule;
  startedAt: string; // the first session the book saw
  asOf: string | null; // the last session it has seen
  strong: boolean | null; // the market on that session: new trades only when strong
  lastPickDate: string | null;
  trades: BookTrade[];
  updatedAt: string;
};

export type BookUpdate = { asOf: string | null; filled: string[]; closed: string[]; opened: string[]; dropped: string[]; note?: string };

type Screen = Array<{ symbol: string; pctile: number; price: number }>;

export const bookKey = (userId: string) => `swing:book:${userId}`;

export async function loadSwingBook(userId: string): Promise<SwingBook | null> {
  const b = await loadQuantSnapshot<SwingBook>(bookKey(userId));
  return b && b.version === 1 && Array.isArray(b.trades) ? b : null;
}

// The step itself, on data already loaded: what the evening job and the tests run.
export function advanceBook(book: SwingBook, screen: Screen, market: { indexAbove200: boolean } | null, bars: Map<string, Array<{ date: string; close: number }>>): BookUpdate {
  const rule = book.rule;
  const res: BookUpdate = { asOf: null, filled: [], closed: [], opened: [], dropped: [] };
  const inPlay = book.trades.filter((t) => t.status === "pending" || t.status === "open");
  const candidates = screen.filter((r) => r.pctile >= rule.minPctile).sort((a, b) => b.pctile - a.pctile).slice(0, 25);

  // The session the data runs to: the latest close among the names in view.
  let asOf: string | null = null;
  for (const s of [...inPlay.map((t) => t.symbol), ...candidates.map((c) => c.symbol)]) {
    const b = bars.get(s);
    const d = b?.[b.length - 1]?.date;
    if (d && (!asOf || d > asOf)) asOf = d;
  }
  if (!asOf) {
    res.note = "no bars";
    return res;
  }
  res.asOf = asOf;

  // 1 and 2: every close since each trade last looked.
  for (const t of inPlay) {
    const b = bars.get(t.symbol) ?? [];
    const wasPending = t.status === "pending";
    for (const bar of b) {
      if (bar.date <= (t.lastDate ?? t.signalDate)) continue;
      if (bar.date > asOf) break;
      stepTrade(t, bar, rule);
      if (t.status === "closed") break;
    }
    if (wasPending && t.status === "open") res.filled.push(t.symbol);
    if (t.status === "closed") res.closed.push(t.symbol);
    // A buy that never filled (the name stopped trading) frees its slot.
    if (t.status === "pending" && sessionsBetween(t.signalDate, asOf) > rule.pendingDays) {
      t.status = "dropped";
      res.dropped.push(t.symbol);
    }
  }

  // 3: new signals, once per session, on the rank as of that session's close.
  const strong = market ? market.indexAbove200 === true : null;
  if (book.lastPickDate !== asOf && (strong === true || (!rule.strongOnly && strong !== null))) {
    const cands: BookCandidate[] = [];
    for (const r of candidates) {
      const b = bars.get(r.symbol);
      const k = b ? b.length - 1 : -1;
      // Only names that traded today, priced as the reading priced them: a
      // reading built before the day's bars came in picks nothing.
      if (!b || k < 61 || b[k].date !== asOf || Math.abs(r.price / b[k].close - 1) > 0.001) continue;
      cands.push({ symbol: r.symbol, pctile: r.pctile, close: b[k].close, sigmaH: sigmaHAt(b, k, rule.horizon) });
    }
    if (cands.length > 0) {
      for (const c of pickTrades(cands, book.trades, asOf, rule)) {
        book.trades.push(newTrade(c, asOf));
        res.opened.push(c.symbol);
      }
      book.lastPickDate = asOf;
    } else res.note = "no candidate priced at the latest close";
  }
  book.asOf = asOf;
  book.strong = strong;
  book.updatedAt = new Date().toISOString();
  return res;
}

// The evening step for one user, on the reading just built for them.
export async function updateSwingBook(userId: string, report: { screen: Screen; market: MarketRead | null }): Promise<BookUpdate> {
  const book: SwingBook =
    (await loadSwingBook(userId)) ?? { version: 1, rule: SWING_BOOK_RULE, startedAt: "", asOf: null, strong: null, lastPickDate: null, trades: [], updatedAt: "" };
  // The rule in the code is the rule in force; a trade keeps the levels and
  // the sell-by it was given at its fill.
  book.rule = SWING_BOOK_RULE;
  const inPlay = book.trades.filter((t) => t.status === "pending" || t.status === "open").map((t) => t.symbol);
  const top = report.screen.filter((r) => r.pctile >= book.rule.minPctile).map((r) => r.symbol);
  const bars = await loadStoredBars([...inPlay, ...top]);
  const res = advanceBook(book, report.screen, report.market, bars);
  if (!book.startedAt && res.asOf) book.startedAt = res.asOf;
  const open = book.trades.filter((t) => t.status === "open").length;
  const pending = book.trades.filter((t) => t.status === "pending").length;
  await saveQuantSnapshot(bookKey(userId), book, `${open} open, ${pending} to buy, ${book.trades.filter((t) => t.status === "closed").length} closed, as of ${book.asOf ?? "-"}`);
  return res;
}
