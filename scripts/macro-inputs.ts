// What the strategy model's scripts (macro-lab, macro-study, macro-final) all
// read, loaded one way: the exchange's archive (bars, cash dividends, the
// yearly liquid universe, the equal-weight market), sectors, and the macro
// series (lib/macro/pk-history.json plus the server's world series, CPI and
// fundamentals in macro-dump.json.gz).

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { loadArchive, loadActions, membership, equalWeightIndex } from "../lib/quant/archive";
import { macroState, logChange, valueOn, monthsBack, type MacroInputs, type Point } from "../lib/macro/series";
import { buildPanel, FACTORS, type PanelRow } from "../lib/macro/panel";
import { sectorKey } from "../lib/calculations/sector-weights";
import symbols from "../lib/psx-symbols.json";
import history from "../lib/macro/pk-history.json";
import type { EodBar } from "../lib/timeseries/psx-eod";

export type Fund = { symbol: string; sector?: string; annual?: Array<{ fiscalYear: number; eps: number | null }>; fiscalYearEndMonth?: number | null };

export type Loaded = {
  bars: Map<string, EodBar[]>;
  members: Map<number, Set<string>>;
  market: EodBar[];
  dividends: Map<string, Array<{ date: string; yieldPct: number }>>;
  dividendsKnown: (date: string) => boolean;
  sectors: Map<string, string>;
  inputs: MacroInputs;
  monthEnds: string[];
  move: (date: string, months: number) => { [K in (typeof FACTORS)[number]]: number | null };
  fund: Fund[];
  rows: PanelRow[];
};

export function loadInputs(archive: string, macroDir: string): Loaded {
  const bars = loadArchive(archive);
  const members = membership(bars, 120);
  const market = equalWeightIndex(bars, members, 10, true);
  const actions = loadActions(archive, bars.keys());
  const dividends = new Map([...actions].map(([s, a]) => [s, a.filter((x) => x.kind === "cash" && x.yieldPct > 0).map((x) => ({ date: x.date, yieldPct: x.yieldPct }))]));

  // The archive's dividend record has gaps (almost none found 2006-2013 and
  // in 2016): where the year before a date holds too few, yields are unknown.
  const allCash = [...dividends.values()].flat().map((d) => d.date).sort();
  const knownOn = new Map<string, boolean>();
  const dividendsKnown = (date: string) => {
    let k = knownOn.get(date);
    if (k == null) {
      const from = new Date(Date.parse(date) - 365 * 86400000).toISOString().slice(0, 10);
      k = allCash.filter((d) => d > from && d <= date).length >= 150;
      knownOn.set(date, k);
    }
    return k;
  };

  const dump = JSON.parse(gunzipSync(readFileSync(join(macroDir, "macro-dump.json.gz"))).toString()) as { macro: { [k: string]: Point[] }; cpi: Array<{ period: string; index: number }>; fund: Fund[] };
  const sectors = new Map<string, string>();
  for (const f of dump.fund) if (f.sector) sectors.set(f.symbol, sectorKey(f.sector));
  for (const s of symbols as Array<{ symbol: string; sector: string }>) if (s.sector) sectors.set(s.symbol, sectorKey(s.sector));

  const inputs: MacroInputs = {
    policy: history.policy as Point[],
    cpiMonthly: dump.cpi,
    cpiAnnual: history.cpiAnnual as Array<[number, number]>,
    gdpAnnual: history.gdpAnnual as Array<[number, number]>,
    oil: dump.macro.oil,
    gold: dump.macro.gold,
    usdpkr: dump.macro.usdpkr,
    spx: dump.macro.spx,
    em: dump.macro.em,
    dxy: dump.macro.dxy,
    us10y: dump.macro.us10y,
    market: market.map((b) => [b.date, b.close] as Point),
  };

  const monthEnds: string[] = [];
  for (let i = 0; i < market.length; i++) if (i === market.length - 1 || market[i + 1].date.slice(0, 7) !== market[i].date.slice(0, 7)) monthEnds.push(market[i].date);

  const move = (date: string, months: number) => ({
    oil: logChange(inputs.oil, date, months, true),
    pkr: logChange(inputs.usdpkr, date, months),
    gold: logChange(inputs.gold, date, months, true),
    policy: (() => {
      const a = valueOn(inputs.policy, date), b = valueOn(inputs.policy, monthsBack(date, months));
      return a != null && b != null ? a - b : null;
    })(),
    spx: logChange(inputs.spx, date, months, true),
  });

  const rows = buildPanel({
    bars,
    dividends,
    dividendsKnown,
    sectorOf: (s) => sectors.get(s) ?? null,
    members: (date) => members.get(Number(date.slice(0, 4))) ?? null,
    market,
    monthEnds,
    macro: (date) => macroState(date, inputs),
    factorMonthly: (date) => move(date, 1),
    factorPush: (date) => move(date, 3),
  });
  return { bars, members, market, dividends, dividendsKnown, sectors, inputs, monthEnds, move, fund: dump.fund, rows };
}
