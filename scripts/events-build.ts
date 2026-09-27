// Build the corporate-action record from the 24-year archive: every cash
// dividend, bonus issue and split the exchange's sheets carry, for every name,
// with what the price did around each against the market.
//
//   npx tsx scripts/events-build.ts [--archive DIR] [--top 120] [--out FILE]
//
// The file goes to the server with jobs/quant-import.js FILE quant:events,
// where the holding and stock pages read it (lib/quant/event-record.ts), and
// the model reads the same actions when it was trained with the event block.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadArchive, membership, equalWeightIndex, type RawRow } from "../lib/quant/archive";
import { extractActions, eventReactions, type EventReaction } from "../lib/quant/events";
import { argOf, num } from "./quant-cli";
import type { EventsSnapshot, EventRow, EventSummary } from "../lib/quant/event-record";

const dir = argOf("archive") || "C:/CC/Data/psx-history";
const out = argOf("out") || join(process.env.TEMP || ".", "psx-events.json");
const t0 = Date.now();

const bars = loadArchive(dir);
const index = equalWeightIndex(bars, membership(bars, num("top", 120)));
const idx = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as { index: Array<{ symbol: string }> };

const symbols: Record<string, EventRow[]> = {};
const all: EventReaction[] = [];
let dataTo = "";
for (const { symbol } of idx.index) {
  const b = bars.get(symbol);
  if (!b) continue;
  if (b[b.length - 1].date > dataTo) dataTo = b[b.length - 1].date;
  let raw: RawRow[];
  try {
    raw = JSON.parse(readFileSync(join(dir, "symbols", symbol + ".json"), "utf8"));
  } catch {
    continue;
  }
  const actions = extractActions(raw).filter((a) => a.kind !== "other");
  if (actions.length === 0) continue;
  const reactions = eventReactions(actions, b, index);
  all.push(...reactions);
  const r4 = (v: number | null) => (v == null ? null : Math.round(v * 1e4) / 1e4);
  symbols[symbol] = reactions.map((e) => [e.date, e.kind, Math.round(e.cash * 100) / 100, Math.round(e.yieldPct * 100) / 100, Math.round(e.ratioPct * 10) / 10, r4(e.before20), r4(e.after5), r4(e.after20)]);
}

function summarize(list: EventReaction[]): EventSummary {
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);
  const b = list.map((e) => e.before20).filter((v): v is number => v != null);
  const a5 = list.map((e) => e.after5).filter((v): v is number => v != null);
  const a = list.map((e) => e.after20).filter((v): v is number => v != null);
  return {
    n: list.length,
    before20Pct: mean(b) * 100,
    after5Pct: mean(a5) * 100,
    after20Pct: mean(a) * 100,
    beatBefore: b.length ? b.filter((v) => v > 0).length / b.length : 0,
    beatAfter: a.length ? a.filter((v) => v > 0).length / a.length : 0,
  };
}

const snapshot: EventsSnapshot = {
  builtAt: new Date().toISOString(),
  dataTo,
  indexKind: "equal-weight, the top 120 by traded value each year",
  coverage: "Cash dividends, bonus issues and splits as the exchange's closing sheets record them (the previous close it adjusts on each ex-date): 2005, then 2013 onward; the sheets carry no adjustments for 2006 to 2012.",
  columns: ["date", "kind", "cash", "yieldPct", "ratioPct", "before20", "after5", "after20"],
  symbols,
  summary: {
    cash: summarize(all.filter((e) => e.kind === "cash")),
    bonus: summarize(all.filter((e) => e.kind === "bonus")),
    split: summarize(all.filter((e) => e.kind === "split")),
  },
};
writeFileSync(out, JSON.stringify(snapshot));
const s = snapshot.summary;
const line = (k: string, x: EventSummary) => `${k.padEnd(6)} ${String(x.n).padStart(5)} events: 20 sessions before ${x.before20Pct >= 0 ? "+" : ""}${x.before20Pct.toFixed(2)}% vs the market (beat it ${Math.round(x.beatBefore * 100)}%), 5 after ${x.after5Pct >= 0 ? "+" : ""}${x.after5Pct.toFixed(2)}%, 20 after ${x.after20Pct >= 0 ? "+" : ""}${x.after20Pct.toFixed(2)}% (beat it ${Math.round(x.beatAfter * 100)}%)`;
console.log(`${Object.keys(symbols).length} names with actions, data to ${dataTo}, in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log(line("cash", s.cash));
console.log(line("bonus", s.bonus));
console.log(line("split", s.split));
console.log(`Wrote ${out}`);
