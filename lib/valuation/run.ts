import "server-only";
import { connectDb } from "@/lib/db";
import { AnnouncementModel, FundamentalModel, ShareEventModel, ValuationAssumptionModel, ValuationRunModel, ValuationTriggerModel } from "@/lib/models";
import { runAsUser } from "@/lib/auth/current-user";
import { getAllUserIds, getPortfolioSummary, getTbill12mPct } from "@/lib/data";
import { latestCloses } from "@/lib/quant/sheet-bars";
import { getQualityFor } from "@/lib/fundamentals/board";
import { getMacroLive } from "@/lib/macro/live";
import { listings } from "@/lib/watchlist";
import { value, metricsOf, firedTriggers, type Assumption, type Signal, type Trigger, type Valuation } from "./engine";
import { draftDiffers, draftSignature, type Draft, type DraftInput } from "./draft";
import { isResultsLetter } from "@/lib/prices/results";

// The daily valuation (after each close, from the evening chain, and on
// demand): every share with an approved assumption, valued on its close and
// the 12-month T-bill (lib/valuation/engine.ts), kept as that close's row
// (lib/models/ValuationRun). What changed since the close before is what the
// alerts send: a signal that moved, a trigger that fired, the T-bill moving
// half a point or more, a thesis gone stale with a new filing, drafts to
// review. And the plan the home machine works its drafts from.

const pktToday = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

export function toAssumption(d: any): Assumption & { asOf: string; version: number } {
  return {
    symbol: d.symbol,
    type: d.type,
    policy: d.policy,
    governance: d.governance,
    confirm: d.confirm || undefined,
    eps: d.eps ?? null,
    dps: d.dps ?? null,
    bvps: d.bvps ?? null,
    roe: d.roe ?? null,
    g: d.g ?? null,
    valueGrowth: d.valueGrowth ?? null,
    pe: d.pe ?? null,
    peSpread: d.peSpread ?? null,
    premium: d.premium ?? null,
    sotp: d.sotp && Array.isArray(d.sotp.parts) && d.sotp.parts.length ? { parts: d.sotp.parts, netDebt: d.sotp.netDebt ?? 0, discount: d.sotp.discount ?? 0, shares: d.sotp.shares ?? 0 } : null,
    weights: d.weights ?? null,
    margins: d.margins ?? null,
    illiquid: !!d.illiquid,
    metrics: d.metrics ?? null,
    asOf: d.asOf,
    version: d.version,
  };
}

// The approved version of each share, newest first.
export async function approvedAssumptions(userId: string, symbols?: string[]): Promise<Map<string, any>> {
  await connectDb();
  const docs = (await ValuationAssumptionModel.find({ userId, status: "approved", ...(symbols ? { symbol: { $in: symbols } } : {}) }).sort({ symbol: 1, version: -1 }).lean()) as any[];
  const out = new Map<string, any>();
  for (const d of docs) if (!out.has(d.symbol)) out.set(d.symbol, d);
  return out;
}

// A results filing newer than the thesis: one the exchange's board posted, or
// one the home machine read for a draft still waiting.
async function staleBy(userId: string, a: Map<string, any>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (a.size === 0) return out;
  const anns = (await AnnouncementModel.find({ symbol: { $in: [...a.keys()] }, kind: "results" }, { symbol: 1, announcedAt: 1, title: 1 }).sort({ announcedAt: -1 }).lean()) as any[];
  for (const n of anns) {
    if (!isResultsLetter(n.title ?? "")) continue;
    const asOf = a.get(n.symbol)?.asOf;
    const day = new Date(n.announcedAt).toISOString().slice(0, 10);
    if (asOf && day > asOf && !out.has(n.symbol)) out.set(n.symbol, `${n.title} (${day})`);
  }
  const drafts = (await ValuationAssumptionModel.find({ userId, status: "draft", symbol: { $in: [...a.keys()] } }, { symbol: 1, evidence: 1 }).lean()) as any[];
  for (const d of drafts) {
    const f = d.evidence?.filing;
    const asOf = a.get(d.symbol)?.asOf;
    if (f?.date && asOf && f.date > asOf && !out.has(d.symbol)) out.set(d.symbol, `${f.title} (${f.date})`);
  }
  return out;
}

export type RunResult = { date: string | null; valued: number; changes: Array<{ symbol: string; from: string; to: string }>; fired: Array<{ symbol: string; id: string }> };

// One user's shares on the latest close. Call inside runAsUser.
export async function runValuations(userId: string, symbols?: string[]): Promise<RunResult> {
  await connectDb();
  const approved = await approvedAssumptions(userId, symbols);
  if (approved.size === 0) return { date: null, valued: 0, changes: [], fired: [] };
  const [closes, tbill, summary, stale, trig] = await Promise.all([
    latestCloses().catch(() => new Map<string, { date: string; close: number }>()),
    getTbill12mPct().catch(() => null),
    getPortfolioSummary().catch(() => null),
    staleBy(userId, approved),
    ValuationTriggerModel.find({ userId, active: true, symbol: { $in: [...approved.keys()] } }).lean() as Promise<any[]>,
  ]);
  if (tbill == null) return { date: null, valued: 0, changes: [], fired: [] };
  const held = new Set((summary?.positions ?? []).filter((p) => p.shares > 0).map((p) => p.symbol));
  const prices = new Map([...closes].map(([s, c]) => [s, c.close]));
  const date = [...closes.values()].reduce((m, c) => (c.date > m ? c.date : m), "");
  if (!date) return { date: null, valued: 0, changes: [], fired: [] };

  const prev = new Map<string, any>();
  for (const r of (await ValuationRunModel.find({ userId, symbol: { $in: [...approved.keys()] }, date: { $lt: date } }, { symbol: 1, date: 1, signal: 1 }).sort({ date: -1 }).lean()) as any[]) if (!prev.has(r.symbol)) prev.set(r.symbol, r);

  const out: RunResult = { date, valued: 0, changes: [], fired: [] };
  for (const [symbol, doc] of approved) {
    const price = prices.get(symbol);
    if (!(price && price > 0)) continue;
    const a = toAssumption(doc);
    const v = value(a, { price, tbillPct: tbill, held: held.has(symbol), stale: stale.has(symbol), prices });
    if (stale.has(symbol)) v.notes.push(`New filing since the thesis: ${stale.get(symbol)}.`);
    const mine: Trigger[] = trig.filter((t) => t.symbol === symbol).map((t) => ({ id: String(t._id), symbol, metric: t.metric, op: t.op, threshold: t.threshold, action: t.action, note: t.note }));
    const fired = firedTriggers(mine, metricsOf(a, v));
    await ValuationRunModel.updateOne(
      { userId, symbol, date },
      { $set: { price, tbillPct: tbill, r: v.r, g: v.g, values: v.values, fairValue: v.fairValue, band: v.band, zones: v.zones, expected: v.expected, excess: v.excess, signal: v.signal, gates: v.gates, notes: v.notes, fired: fired.map((t) => t.id), version: a.version } },
      { upsert: true }
    );
    if (fired.length) await ValuationTriggerModel.updateMany({ _id: { $in: fired.map((t) => t.id) } }, { $set: { lastFiredAt: date } });
    const before = prev.get(symbol)?.signal;
    if (before && before !== v.signal) out.changes.push({ symbol, from: before, to: v.signal });
    out.fired.push(...fired.map((t) => ({ symbol, id: t.id })));
    out.valued++;
  }
  return out;
}

export async function runValuationsAll(): Promise<Array<RunResult & { user: string }>> {
  const out: Array<RunResult & { user: string }> = [];
  for (const id of await getAllUserIds()) {
    try {
      out.push({ user: id.slice(-6), ...((await runAsUser(id, () => runValuations(id))) as RunResult) });
    } catch (e) {
      out.push({ user: id.slice(-6), date: null, valued: 0, changes: [], fired: [] });
    }
  }
  return out;
}

// The latest close's rows with the version behind each, for the pages.
export async function latestRuns(userId: string): Promise<{ date: string | null; rows: any[]; previous: Map<string, any> }> {
  await connectDb();
  const last: any = await ValuationRunModel.findOne({ userId }, { date: 1 }).sort({ date: -1 }).lean();
  if (!last) return { date: null, rows: [], previous: new Map() };
  const rows = (await ValuationRunModel.find({ userId, date: last.date }).lean()) as any[];
  const prev = new Map<string, any>();
  for (const r of (await ValuationRunModel.find({ userId, date: { $lt: last.date } }).sort({ date: -1 }).limit(2000).lean()) as any[]) if (!prev.has(r.symbol)) prev.set(r.symbol, r);
  return { date: last.date, rows, previous: prev };
}

const money = (v: number) => (v >= 100 ? Math.round(v).toLocaleString("en-US") : v.toFixed(2));
const LABEL: Record<string, string> = { STRONG: "strong buy", ACCUMULATE: "accumulate", CONFIRM: "in zone, confirm first", WAIT: "wait", HOLD: "hold", TRIM: "trim", AVOID: "avoid", STALE: "stale: review", WATCH: "watch", "NO VALUE": "no value" };

// The messages the alerts job sends for the latest close (each once).
export async function valuationAlerts(userId: string): Promise<Array<{ key: string; message: string }>> {
  const { date, rows, previous } = await latestRuns(userId);
  const out: Array<{ key: string; message: string }> = [];
  if (date) {
    for (const r of rows) {
      const p = previous.get(r.symbol);
      if (p && p.signal !== r.signal) {
        const z = r.zones ? ` Zones: accumulate ≤${money(r.zones.accumulate)}, strong ≤${money(r.zones.strong)}, trim ≥${money(r.zones.trim)}.` : "";
        const er = r.expected ? ` Expected ${r.expected.total.toFixed(1)}% against a ${r.r.toFixed(1)}% hurdle.` : "";
        out.push({ key: `val-signal:${r.symbol}:${date}:${r.signal}`, message: `🔔 <b>${r.symbol}</b> ${LABEL[p.signal] ?? p.signal} → <b>${LABEL[r.signal] ?? r.signal}</b> at Rs ${money(r.price)}${r.fairValue ? ` (fair ${money(r.fairValue)})` : ""}.${z}${er}` });
      }
    }
    const fired = rows.filter((r) => (r.fired ?? []).length);
    if (fired.length) {
      const ids = fired.flatMap((r) => r.fired);
      const trig = (await ValuationTriggerModel.find({ _id: { $in: ids } }).lean()) as any[];
      for (const t of trig) out.push({ key: `val-trigger:${t._id}:${date}`, message: `⚠️ <b>${t.symbol}</b> trigger: ${t.metric} ${t.op} ${t.threshold} → <b>${t.action}</b>${t.note ? ` (${t.note})` : ""}.` });
    }
    const now = rows[0]?.tbillPct, then = rows.map((r) => previous.get(r.symbol)?.tbillPct).find((x) => x != null);
    if (now != null && then != null && Math.abs(now - then) >= 0.5) out.push({ key: `val-tbill:${date}`, message: `📈 12-month T-bill ${then.toFixed(2)}% → <b>${now.toFixed(2)}%</b>: every hurdle and zone moved.` });
  }
  const drafts = (await ValuationAssumptionModel.find({ userId, status: "draft" }, { symbol: 1, createdAt: 1 }).sort({ createdAt: -1 }).lean()) as any[];
  if (drafts.length) out.push({ key: `val-drafts:${new Date(drafts[0].createdAt).toISOString().slice(0, 10)}:${drafts.length}`, message: `📝 ${drafts.length} valuation draft${drafts.length === 1 ? "" : "s"} to review: ${[...new Set(drafts.map((d) => d.symbol))].slice(0, 8).join(", ")}.` });
  return out;
}

// --- drafts ---------------------------------------------------------------------

// The data the home machine works a draft from, for every share a user holds
// or has an assumption for; the filings it reads itself, except the one it
// read last time for that share (knownFiling), which it does not fetch again.
type KnownFiling = NonNullable<DraftInput["filing"]>;
type PlanItem = { userId: string; symbol: string; lastAsOf: string | null; knownFiling: KnownFiling | null; input: Omit<DraftInput, "filing"> };
export async function draftPlan(): Promise<PlanItem[]> {
  await connectDb();
  const live = await getMacroLive().catch(() => null);
  const thin = new Map((live?.names ?? []).map((n) => [n.symbol, n.thin]));
  const sectorOf = new Map(listings().map((l) => [l.symbol, l.sector]));
  const today = pktToday();
  const out: PlanItem[] = [];
  for (const userId of await getAllUserIds()) {
    await runAsUser(userId, async () => {
      const summary = await getPortfolioSummary().catch(() => null);
      const held = (summary?.positions ?? []).filter((p) => p.shares > 0).map((p) => p.symbol);
      const docs = (await ValuationAssumptionModel.find({ userId }, { symbol: 1, status: 1, version: 1 }).sort({ version: -1 }).lean()) as any[];
      const symbols = [...new Set([...held, ...docs.map((d) => d.symbol)])];
      if (!symbols.length) return;
      const [funds, events, quality, approved] = await Promise.all([
        FundamentalModel.find({ symbol: { $in: symbols } }, { symbol: 1, annual: 1, sharesOutstanding: 1, fiscalYearEndMonth: 1, balanceSheet: 1, sector: 1 }).lean() as Promise<any[]>,
        ShareEventModel.find({ symbol: { $in: symbols }, kind: "cash", date: { $gte: new Date(Date.now() - 800 * 86400000).toISOString().slice(0, 10) } }, { symbol: 1, date: 1, cash: 1 }).lean() as Promise<any[]>,
        getQualityFor(symbols).catch(() => new Map()),
        approvedAssumptions(userId, symbols),
      ]);
      const fundOf = new Map(funds.map((f) => [f.symbol, f]));
      for (const symbol of symbols) {
        const f = fundOf.get(symbol);
        const prev = approved.get(symbol) ?? (await ValuationAssumptionModel.findOne({ userId, symbol }).sort({ version: -1 }).lean());
        out.push({
          userId,
          symbol,
          lastAsOf: approved.get(symbol)?.asOf ?? null,
          knownFiling: null,
          input: {
            symbol,
            sector: sectorOf.get(symbol) ?? (f?.sector ? String(f.sector).toUpperCase() : ""),
            grade: (quality.get(symbol) as any)?.grade ?? null,
            thin: thin.get(symbol) ?? true,
            annual: (f?.annual ?? []).map((r: any) => ({ fiscalYear: r.fiscalYear, eps: r.eps ?? null, profitAfterTax: r.profitAfterTax ?? null })),
            sharesNow: f?.sharesOutstanding ?? null,
            fiscalYearEndMonth: f?.fiscalYearEndMonth ?? null,
            equity: f?.balanceSheet?.equity ?? null,
            equityAt: f?.balanceSheet?.periodEnd ?? null,
            cashDividends: events.filter((e) => e.symbol === symbol).map((e) => ({ date: e.date, cash: e.cash })),
            today,
            previous: prev ? { ...toAssumption(prev) } : null,
          },
        });
      }
    });
  }
  const read = (await ValuationAssumptionModel.find({ symbol: { $in: [...new Set(out.map((o) => o.symbol))] }, source: "auto", "evidence.filing.url": { $type: "string" } }, { symbol: 1, "evidence.filing": 1 }).sort({ createdAt: -1 }).lean()) as any[];
  const known = new Map<string, KnownFiling>();
  for (const d of read) {
    const f = d.evidence.filing;
    if (!known.has(d.symbol)) known.set(d.symbol, { date: f.date, title: f.title ?? "", url: f.url, period: f.period ?? null, periodEnd: f.periodEnd ?? null, eps: f.eps ?? null, epsPrior: f.epsPrior ?? null, profit: f.profit ?? null, equity: f.equity ?? null, revaluation: f.revaluation ?? null, dps: f.dps ?? null, basis: f.basis ?? null, source: f.source ?? "text", checks: f.checks ?? [], text: !!f.readable });
  }
  for (const o of out) o.knownFiling = known.get(o.symbol) ?? null;
  return out;
}

// Drafts from the home machine, kept where they say something new.
export async function storeDrafts(drafts: Array<{ userId: string; symbol: string; draft: Draft }>): Promise<number> {
  await connectDb();
  let kept = 0;
  for (const d of drafts) {
    if (!d?.userId || !d?.symbol || !d?.draft) continue;
    const last: any = await ValuationAssumptionModel.findOne({ userId: d.userId, symbol: d.symbol }).sort({ version: -1 }).lean();
    const lastLive: any = await ValuationAssumptionModel.findOne({ userId: d.userId, symbol: d.symbol, status: { $in: ["approved", "draft"] } }).sort({ version: -1 }).lean();
    if (lastLive && !draftDiffers(d.draft, lastLive)) continue;
    const sig = draftSignature(d.draft);
    if (await ValuationAssumptionModel.exists({ userId: d.userId, symbol: d.symbol, source: "auto", "evidence.sig": sig })) continue;
    // A newer draft replaces an older one still waiting.
    await ValuationAssumptionModel.updateMany({ userId: d.userId, symbol: d.symbol, status: "draft" }, { $set: { status: "rejected" } });
    const { evidence, note, ...fields } = d.draft;
    await ValuationAssumptionModel.create({ ...fields, userId: d.userId, symbol: d.symbol, version: (last?.version ?? 0) + 1, status: "draft", source: "auto", note: note ?? "", evidence: { ...(evidence ?? {}), sig } });
    kept++;
  }
  return kept;
}

// Approving a version: the one before it is superseded, it counts as
// reviewed today, and the share is valued again at once.
export async function approveVersion(userId: string, id: string): Promise<boolean> {
  await connectDb();
  const doc: any = await ValuationAssumptionModel.findOne({ _id: id, userId }).lean();
  if (!doc) return false;
  await ValuationAssumptionModel.updateMany({ userId, symbol: doc.symbol, status: "approved" }, { $set: { status: "superseded" } });
  // Approved means reviewed today: a filing after today is what makes it stale.
  const today = pktToday();
  await ValuationAssumptionModel.updateOne({ _id: id }, { $set: { status: "approved", asOf: doc.asOf > today ? doc.asOf : today } });
  await runValuations(userId, [doc.symbol]).catch(() => null);
  return true;
}

export type BoardRow = { symbol: string; name: string; run: any | null; assumption: any; draft: any | null; held: boolean };
export type { Valuation, Signal };
