// The corporate-action record as the site reads it: every cash dividend, bonus
// issue and split per name, with what the price did around each against the
// market (scripts/events-build.ts writes it on the training machine; it is
// imported under quant:events). Read once and kept for half an hour: it is a
// few hundred kilobytes and changes when the archive does.

import { loadQuantSnapshot } from "./store";
import type { ActionKind } from "./events";

// [date, kind, cash (Rs), yieldPct, ratioPct, before20, after5, after20]; the
// three moves are log returns against the index, null where history is short.
export type EventRow = [string, ActionKind, number, number, number, number | null, number | null, number | null];

export type EventSummary = { n: number; before20Pct: number; after5Pct: number; after20Pct: number; beatBefore: number; beatAfter: number };

export type EventsSnapshot = {
  builtAt: string;
  dataTo: string;
  indexKind: string;
  coverage: string;
  columns: string[];
  symbols: Record<string, EventRow[]>;
  summary: { cash: EventSummary; bonus: EventSummary; split: EventSummary };
};

export type EventRecord = {
  symbol: string;
  rows: Array<{ date: string; kind: ActionKind; cash: number; yieldPct: number; ratioPct: number; before20Pct: number | null; after5Pct: number | null; after20Pct: number | null }>;
  own: { dividends: number; since: string | null; before20Pct: number | null; after20Pct: number | null; beatBefore: number | null; yield12Pct: number };
  market: EventSummary;
  dataTo: string;
  coverage: string;
};

let cache: { at: number; snap: EventsSnapshot | null } | null = null;

async function snapshot(): Promise<EventsSnapshot | null> {
  if (cache && Date.now() - cache.at < 30 * 60 * 1000) return cache.snap;
  const snap = await loadQuantSnapshot<EventsSnapshot>("quant:events").catch(() => null);
  cache = { at: Date.now(), snap };
  return snap;
}

export async function getEventRecord(symbol: string): Promise<EventRecord | null> {
  const snap = await snapshot();
  return snap ? recordFrom(snap, symbol) : null;
}

// The record for one name out of the snapshot: pure, so a page can be shown
// from a file as well as from the store.
export function recordFrom(snap: EventsSnapshot, symbol: string): EventRecord | null {
  const list = snap.symbols[symbol.toUpperCase()];
  if (!list || list.length === 0) return null;
  const pct = (v: number | null) => (v == null ? null : (Math.exp(v) - 1) * 100);
  const rows = list.map(([date, kind, cash, yieldPct, ratioPct, b, a5, a]) => ({ date, kind, cash, yieldPct, ratioPct, before20Pct: pct(b), after5Pct: pct(a5), after20Pct: pct(a) }));
  const divs = rows.filter((r) => r.kind === "cash");
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);
  const b = divs.map((r) => r.before20Pct).filter((v): v is number => v != null);
  const a = divs.map((r) => r.after20Pct).filter((v): v is number => v != null);
  const yearAgo = new Date(Date.parse(snap.dataTo) - 365 * 86400000).toISOString().slice(0, 10);
  return {
    symbol: symbol.toUpperCase(),
    rows: rows.slice().reverse(),
    own: {
      dividends: divs.length,
      since: divs[0]?.date ?? null,
      before20Pct: mean(b),
      after20Pct: mean(a),
      beatBefore: b.length ? b.filter((v) => v > 0).length / b.length : null,
      yield12Pct: divs.filter((r) => r.date > yearAgo).reduce((s, r) => s + r.yieldPct, 0),
    },
    market: snap.summary.cash,
    dataTo: snap.dataTo,
    coverage: snap.coverage,
  };
}
