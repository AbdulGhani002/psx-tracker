import "server-only";
import { connectDb } from "@/lib/db";
import { BuyListModel, FeedSnapshotModel, HoldingModel, PriceSnapshotModel } from "@/lib/models";
import { dpsFetch, dpsResting, keepRelayedPages } from "@/lib/prices/dps";
import { parseAsOf, parseIndexConstituents } from "@/lib/timeseries/dps-indices";
import { refreshCloses } from "@/lib/quant/daily";
import { marketHolidays } from "@/lib/market-calendar";
import { manualPlan } from "@/lib/calculations/manual-prices";
import { dayLabel } from "@/lib/calculations/sweep";

// The Update prices button, beside the one daily read (lib/prices/sweep):
// one update now, planned by lib/calculations/manual-prices. A price read from
// the all-share page is stamped no later than 10:59 UTC of the page's day, so
// the official close (stamped 11:00 UTC by keepClosePrices) outranks it once
// the closing file is in.

const KEY = "prices:manual";
const PAGE = "/indices/ALLSHR";
const pkDay = (t: number) => new Date(t + 5 * 3600_000).toISOString().slice(0, 10);
const hhmm = (t: number) => new Date(t + 5 * 3600_000).toISOString().slice(11, 16);

export type ManualResult = { ok: boolean; what: "close" | "live" | "none" | "wait"; updated: number; note: string };

let running = false;

async function latestFile(): Promise<string | null> {
  const d: any = await FeedSnapshotModel.findOne({ key: /^dps:closing:/ }, { key: 1 }).sort({ key: -1 }).lean();
  return d ? String(d.key).slice("dps:closing:".length) : null;
}

async function watched(): Promise<string[]> {
  const [held, buy] = await Promise.all([HoldingModel.distinct("symbol", { currentShares: { $gt: 0 } }), BuyListModel.distinct("symbol", {})]);
  return [...new Set([...(held as string[]), ...(buy as string[])])];
}

async function readLive(now: number): Promise<{ updated: number; time: string } | null> {
  const res = await dpsFetch(PAGE, { headers: { accept: "text/html" } }, { sweep: true, relay: false, timeoutMs: 30_000 });
  if (!res.ok) return null;
  const html = await res.text();
  const rows = parseIndexConstituents(html);
  if (rows.length === 0) return null;
  await keepRelayedPages({ [PAGE]: { html, fetchedAt: new Date(now).toISOString() } });
  const at = parseAsOf(html);
  const day = at?.date ?? pkDay(now);
  const time = at ? `${String(Math.floor(at.minutes / 60)).padStart(2, "0")}:${String(at.minutes % 60).padStart(2, "0")}` : hhmm(now);
  const stamp = new Date(Math.min(now, Date.parse(day + "T10:59:00Z")));
  const want = new Set(await watched());
  const docs = rows.filter((r) => want.has(r.symbol)).map((r) => ({ symbol: r.symbol, price: r.current, timestamp: stamp, source: "dps-live", isMarketHours: true, asOf: `${day} ${time}` }));
  if (docs.length > 0) await PriceSnapshotModel.insertMany(docs);
  return { updated: docs.length, time };
}

export async function updatePricesNow(now = Date.now()): Promise<ManualResult> {
  if (running) return { ok: true, what: "wait", updated: 0, note: "An update is running" };
  running = true;
  try {
    await connectDb();
    const [holidays, last, file] = await Promise.all([marketHolidays(), FeedSnapshotModel.findOne({ key: KEY }).lean() as Promise<any>, latestFile()]);
    const lastAt = last?.data?.at ? Date.parse(last.data.at) : null;
    const plan = manualPlan({ now, holidays, lastAt, latestFile: file });
    if (plan.step === "wait") return { ok: true, what: "wait", updated: 0, note: `Updated at ${hhmm(lastAt!)}; the next update from ${hhmm(plan.nextAt!)}` };
    if (plan.step === "none") return { ok: true, what: "none", updated: 0, note: `Prices are already the close of ${dayLabel(file ?? plan.day)}` };
    const resting = await dpsResting();
    if (resting) return { ok: false, what: "none", updated: 0, note: `The exchange is refusing reads until ${hhmm(Date.parse(resting.until))}` };

    let out: ManualResult | null = null;
    if (plan.step === "close" || plan.step === "close-then-live") {
      const r = await refreshCloses().catch(() => null);
      const got = r?.sheets.latest ?? null;
      if (got && got >= plan.day) {
        const held = (await HoldingModel.distinct("symbol", { currentShares: { $gt: 0 } })) as string[];
        const saved = await PriceSnapshotModel.countDocuments({ source: "dps-close", asOf: got, symbol: { $in: held } });
        out = { ok: true, what: "close", updated: saved, note: `Closing prices of ${dayLabel(got)} in` };
      } else if (plan.step === "close") out = { ok: false, what: "none", updated: 0, note: `The closing file of ${dayLabel(plan.day)} is not out yet` };
    }
    if (!out) {
      const live = await readLive(now).catch(() => null);
      out = live ? { ok: true, what: "live", updated: live.updated, note: `Prices as of ${live.time}` } : { ok: false, what: "none", updated: 0, note: "The exchange did not answer; prices stay as they were" };
    }
    await FeedSnapshotModel.updateOne({ key: KEY }, { $set: { key: KEY, data: { at: new Date(now).toISOString(), what: out.what, updated: out.updated }, status: out.ok ? "ok" : "error", note: out.note.slice(0, 160), updatedAt: new Date() } }, { upsert: true });
    return out;
  } finally {
    running = false;
  }
}

// The line beside the button: how new the prices of one user's shares are.
export async function pricesLabel(userId: string): Promise<string> {
  await connectDb();
  const held = (await HoldingModel.distinct("symbol", { userId, currentShares: { $gt: 0 } })) as string[];
  const p: any = held.length ? await PriceSnapshotModel.findOne({ symbol: { $in: held } }, { source: 1, asOf: 1, timestamp: 1 }).sort({ timestamp: -1 }).lean() : null;
  if (!p) return "No prices yet";
  const asOf = String(p.asOf ?? "");
  if (p.source === "dps-live" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(asOf)) return `Prices as of ${asOf.slice(11)}, ${dayLabel(asOf.slice(0, 10))}`;
  if (p.source === "dps-close" && /^\d{4}-\d{2}-\d{2}$/.test(asOf)) return `Prices are the close of ${dayLabel(asOf)}`;
  return `Prices of ${dayLabel(pkDay(new Date(p.timestamp).getTime()))}`;
}
