// Where the trained network lives between the weekly training run and the
// daily report: one document in the feed store, small enough to read on every
// report (three networks of a couple of thousand weights each) and carrying
// its own out-of-sample record so the report can print what the forecasts are
// worth without recomputing anything.
//
// This module talks to Mongo directly rather than through lib/data because
// the training job runs as its own Node process outside Next, where the
// server-only data layer cannot be imported.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connectDb } from "@/lib/db";
import { FeedSnapshotModel } from "@/lib/models/FeedSnapshot";
import type { EodBar } from "@/lib/timeseries/psx-eod";
import type { Learner, PanelOptions, PanelWalkResult } from "./panel";
import type { StrategyResult } from "./strategy";
import type { SwingStats } from "./swing";
import type { IndexOutlookModel, OutlookRecord } from "./outlook";
import type { BarsCache } from "./universe";

export const QUANT_MODEL_KEY = "quant:model";

// The KSE-100 state table (outlook.ts) fitted on the 1997-to-date series,
// with its walk-forward record against the unconditional table.
export type StoredIndexOutlook = {
  model: IndexOutlookModel;
  record: OutlookRecord;
  yearly: Array<{ year: string; n: number; brierSkillPct: number; cover80: number }>;
  seriesFrom: string;
  seriesTo: string;
  joinedAt: string;
};

export type StoredQuantModel = {
  version: 2;
  trainedOn: string; // ISO timestamp of the run
  trainedTo: string; // last session whose outcome was in the training set
  horizon: number;
  dipPct: number;
  featureNames: string[]; // base features followed by the context names, in row order
  contextNames: string[];
  rankNames: string[]; // empty when the model was trained without cross-sectional ranks
  // The feature blocks the panel was built with; the report rebuilds today's
  // rows the same way. Absent on models stored before either existed.
  featureSet?: { extras: boolean; xs: boolean; events?: boolean };
  targetNames: string[];
  universe: string[];
  universeSource: string;
  trainedFrom: "eod" | "archive"; // the five-year feed, or the 24-year archive
  indexKind: "kse100" | "equal-weight"; // what the idx* features were built on
  strategy: StrategyResult | null; // the rule test on the walk-forward points
  swing?: SwingStats[] | null; // swing trades at the zones' levels, same points
  // Where the zones are read from: the model's path curve, or the plain walk
  // over each name's volatility when the model's did not place them better
  // out of sample (panel.ts zoneSourceOf). Absent: the model's curve.
  zoneSource?: "model" | "walk";
  rows: number;
  config: PanelOptions;
  finalRounds: number[] | null; // per target, when the final boosters used fixed rounds
  indexOutlook?: StoredIndexOutlook | null;
  learners: Learner[];
  validation: Omit<PanelWalkResult, "points"> | null;
  runtimeSec: number;
};

export async function saveQuantModel(m: StoredQuantModel): Promise<void> {
  await connectDb();
  await FeedSnapshotModel.findOneAndUpdate(
    { key: QUANT_MODEL_KEY },
    { key: QUANT_MODEL_KEY, data: m, status: "ok", note: `${m.rows} rows, ${m.universe.length} names, horizon ${m.horizon}`, updatedAt: new Date() },
    { upsert: true }
  );
}

export async function loadQuantModel(): Promise<StoredQuantModel | null> {
  await connectDb();
  const doc: any = await FeedSnapshotModel.findOne({ key: QUANT_MODEL_KEY }).lean();
  const data = doc?.data as StoredQuantModel | undefined;
  return data && data.version === 2 && Array.isArray(data.learners) && data.learners.length > 0 ? data : null;
}

// Any other quant result worth keeping between runs (the long-history
// validation, for one), under its own key.
export async function saveQuantSnapshot(key: string, data: unknown, note = ""): Promise<void> {
  await connectDb();
  await FeedSnapshotModel.findOneAndUpdate({ key }, { key, data, status: "ok", note, updatedAt: new Date() }, { upsert: true });
}

export async function loadQuantSnapshot<T>(key: string): Promise<T | null> {
  await connectDb();
  const doc: any = await FeedSnapshotModel.findOne({ key }).lean();
  return (doc?.data as T) ?? null;
}

type CachedBars = { fetchedAt: string; bars: EodBar[] };
const fresh = (c: CachedBars | null | undefined, maxAgeHours: number) =>
  !!c && Array.isArray(c.bars) && c.bars.length > 0 && Date.now() - Date.parse(c.fetchedAt) < maxAgeHours * 3600 * 1000;

export function mongoBarsCache(maxAgeHours = 6): BarsCache {
  return {
    async get(symbol) {
      await connectDb();
      const doc: any = await FeedSnapshotModel.findOne({ key: `eod:bars:${symbol}` }).lean();
      const c = doc?.data as CachedBars | undefined;
      return fresh(c, maxAgeHours) ? c!.bars : null;
    },
    async getStale(symbol) {
      await connectDb();
      const doc: any = await FeedSnapshotModel.findOne({ key: `eod:bars:${symbol}` }).lean();
      const c = doc?.data as CachedBars | undefined;
      return c && Array.isArray(c.bars) && c.bars.length > 0 ? c.bars : null;
    },
    async put(symbol, bars) {
      await connectDb();
      const data: CachedBars = { fetchedAt: new Date().toISOString(), bars };
      await FeedSnapshotModel.findOneAndUpdate(
        { key: `eod:bars:${symbol}` },
        { key: `eod:bars:${symbol}`, data, status: "ok", note: `${bars.length} sessions to ${bars[bars.length - 1]?.date ?? ""}`, updatedAt: new Date() },
        { upsert: true }
      );
    },
  };
}

export function diskBarsCache(dir: string, maxAgeHours = 6): BarsCache {
  mkdirSync(dir, { recursive: true });
  return {
    async get(symbol) {
      const f = join(dir, symbol + ".json");
      if (!existsSync(f)) return null;
      try {
        const c = JSON.parse(readFileSync(f, "utf8"));
        // Older cache files were a bare array; treat them as fresh enough.
        if (Array.isArray(c)) return c.length > 0 ? (c as EodBar[]) : null;
        return fresh(c, maxAgeHours) ? (c as CachedBars).bars : null;
      } catch {
        return null;
      }
    },
    async getStale(symbol) {
      const f = join(dir, symbol + ".json");
      if (!existsSync(f)) return null;
      try {
        const c = JSON.parse(readFileSync(f, "utf8"));
        return Array.isArray(c) ? (c as EodBar[]) : (c as CachedBars).bars ?? null;
      } catch {
        return null;
      }
    },
    async put(symbol, bars) {
      const data: CachedBars = { fetchedAt: new Date().toISOString(), bars };
      writeFileSync(join(dir, symbol + ".json"), JSON.stringify(data));
    },
  };
}
