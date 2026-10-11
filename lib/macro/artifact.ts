// The strategy model as it travels from the training machine to the server
// (scripts/macro-final.ts writes it, quant-import.js stores it under
// MACRO_MODEL_KEY): the network that ranks shares, its tested record against
// the plain rules, how each sector moves with the macro factors, what the
// timing test found, and the monthly history "times like now" is read from.

import type { Mlp } from "./mlp";
import type { WalkRecord } from "./models";
import type { Sensitivity, TimingRecord } from "./analytics";
import type { PanelRow } from "./panel";

// What each tenth of a ranking went on to do, month by month: the 3-month
// return against the market (a log return turned simple) and how often it
// beat the market. `pred` is aligned with `rows`; months with fewer than 20
// scored names are left out.
export function calibrate(rows: PanelRow[], pred: number[]): Calibration {
  const byMonth = new Map<string, number[]>();
  rows.forEach((r, i) => {
    if (Number.isFinite(pred[i]) && r.fwd3 != null && Number.isFinite(r.fwd3)) (byMonth.get(r.date) ?? byMonth.set(r.date, []).get(r.date)!).push(i);
  });
  const acc = Array.from({ length: 10 }, () => ({ sum: 0, hit: 0, n: 0 }));
  for (const idx of byMonth.values()) {
    if (idx.length < 20) continue;
    const order = [...idx].sort((a, b) => pred[a] - pred[b]);
    order.forEach((i, k) => {
      const d = Math.min(9, Math.floor((k / order.length) * 10));
      acc[d].sum += Math.exp(rows[i].fwd3!) - 1;
      acc[d].hit += rows[i].fwd3! > 0 ? 1 : 0;
      acc[d].n++;
    });
  }
  return acc.map((a, d) => ({ lo: d / 10, hi: (d + 1) / 10, rel3: a.n ? a.sum / a.n : 0, hit: a.n ? a.hit / a.n : 0, n: a.n }));
}

export const MACRO_MODEL_KEY = "macro:model";

export type AnalogMonth = {
  date: string;
  x: number[]; // the state, in `analogNames` order
  mkt3: number | null; // the market's log return over the next 3, 6 and 12 months
  mkt6: number | null;
  mkt12: number | null;
  best: Array<[string, number]>; // the sectors that did best against the market over the next 6 months
  worst: Array<[string, number]>;
  dy: number | null; // the universe's median dividend yield then, %
};

export type MacroModel = {
  version: 1;
  builtAt: string;
  dataTo: string; // the last month in the panel
  trainedTo: string; // the last month whose 3-month outcome was known
  universe: string; // how the training universe was drawn
  features: string[]; // the network's inputs, by panel name
  nets: Mlp[]; // averaged
  record: WalkRecord;
  baselines: Array<{ name: string; ic: number; icT: number; spread: number; sectorIc: number }>;
  sensitivities: { factors: string[]; rows: Sensitivity[] };
  timing: { trend: TimingRecord; macro: TimingRecord; analogs: TimingRecord; always: TimingRecord };
  analogNames: string[];
  analogHistory: AnalogMonth[];
  // What each tenth of the ranking went on to do on the years the network
  // never saw: the 3-month return against the market, how often it beat it.
  calibration?: Calibration;
};

export type Calibration = Array<{ lo: number; hi: number; rel3: number; hit: number; n: number }>;
