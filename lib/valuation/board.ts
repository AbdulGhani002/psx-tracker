import "server-only";
import { connectDb } from "@/lib/db";
import { AnnouncementModel, FundamentalModel, ShareEventModel, ValuationAssumptionModel, ValuationRunModel, ValuationTriggerModel } from "@/lib/models";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { getPortfolioSummary, getTbill12mPct } from "@/lib/data";
import { latestCloses } from "@/lib/quant/sheet-bars";
import { getQualityFor } from "@/lib/fundamentals/board";
import { getMacroLive } from "@/lib/macro/live";
import { listings } from "@/lib/watchlist";
import { hurdle, value, type Valuation } from "./engine";
import { draftFrom, type Draft } from "./draft";
import { latestRuns, toAssumption } from "./run";
import { isResultsLetter } from "@/lib/prices/results";

// What the valuation pages show (app/valuation): every share valued on the
// latest close in rank order, the drafts and stale theses waiting for review,
// and for one share its versions, its valuation today, its triggers and the
// filings since its thesis.

const pktToday = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
const nameOf = () => new Map(listings().map((l) => [l.symbol, l.name]));

export async function getValuationBoard() {
  await connectDb();
  const userId = (await getCurrentUserId()) ?? "";
  const [tbill, summary, runs, docs] = await Promise.all([
    getTbill12mPct().catch(() => null),
    getPortfolioSummary().catch(() => null),
    latestRuns(userId),
    ValuationAssumptionModel.find({ userId, status: { $in: ["approved", "draft"] } }).sort({ version: -1 }).lean() as Promise<any[]>,
  ]);
  const names = nameOf();
  const held = new Set((summary?.positions ?? []).filter((p) => p.shares > 0).map((p) => p.symbol));
  const approved = new Map<string, any>(), drafts = new Map<string, any>();
  for (const d of docs) {
    const m = d.status === "approved" ? approved : drafts;
    if (!m.has(d.symbol)) m.set(d.symbol, d);
  }
  const runOf = new Map(runs.rows.map((r) => [r.symbol, r]));
  const rows = [...approved.values()].map((a) => ({ symbol: a.symbol, name: names.get(a.symbol) ?? a.symbol, held: held.has(a.symbol), run: runOf.get(a.symbol) ?? null, prev: runs.previous.get(a.symbol) ?? null, assumption: a, draft: drafts.get(a.symbol) ?? null }));
  const ORDER: Record<string, number> = { STRONG: 0, ACCUMULATE: 1, CONFIRM: 2, STALE: 3, TRIM: 4, HOLD: 5, WAIT: 6, WATCH: 7, AVOID: 8, "NO VALUE": 9 };
  rows.sort((a, b) => (ORDER[a.run?.signal ?? "NO VALUE"] ?? 9) - (ORDER[b.run?.signal ?? "NO VALUE"] ?? 9) || (b.run?.excess ?? -1e9) - (a.run?.excess ?? -1e9));
  const review = [...drafts.values()].map((d) => ({ symbol: d.symbol, name: names.get(d.symbol) ?? d.symbol, draft: d, approved: approved.get(d.symbol) ?? null }));
  return {
    date: runs.date,
    tbill,
    hurdles: tbill != null ? { quality: hurdle(tbill, { policy: "quality" }), standard: hurdle(tbill, { policy: "standard" }) } : null,
    rows,
    review,
    stale: rows.filter((r) => r.run?.gates?.stale).map((r) => r.symbol),
    heldWithout: [...held].filter((s) => !approved.has(s) && !drafts.has(s)).sort(),
  };
}

// A first draft for a share with no version yet, from what the server holds
// (the home machine's draft also reads the filings).
async function suggestion(symbol: string): Promise<Draft> {
  const [f, events, quality, live] = await Promise.all([
    FundamentalModel.findOne({ symbol }, { annual: 1, sharesOutstanding: 1, fiscalYearEndMonth: 1, balanceSheet: 1, sector: 1 }).lean() as Promise<any>,
    ShareEventModel.find({ symbol, kind: "cash", date: { $gte: new Date(Date.now() - 800 * 86400000).toISOString().slice(0, 10) } }, { date: 1, cash: 1 }).lean() as Promise<any[]>,
    getQualityFor([symbol]).catch(() => new Map()),
    getMacroLive().catch(() => null),
  ]);
  const listing = listings().find((l) => l.symbol === symbol);
  return draftFrom({
    symbol,
    sector: listing?.sector ?? (f?.sector ? String(f.sector).toUpperCase() : ""),
    grade: (quality.get(symbol) as any)?.grade ?? null,
    thin: live?.names.find((n) => n.symbol === symbol)?.thin ?? true,
    annual: (f?.annual ?? []).map((r: any) => ({ fiscalYear: r.fiscalYear, eps: r.eps ?? null, profitAfterTax: r.profitAfterTax ?? null })),
    sharesNow: f?.sharesOutstanding ?? null,
    fiscalYearEndMonth: f?.fiscalYearEndMonth ?? null,
    equity: f?.balanceSheet?.equity ?? null,
    equityAt: f?.balanceSheet?.periodEnd ?? null,
    cashDividends: events.map((e) => ({ date: e.date, cash: e.cash })),
    today: pktToday(),
    previous: null,
  });
}

export async function getValuationCompany(symbol: string) {
  await connectDb();
  const userId = (await getCurrentUserId()) ?? "";
  const sym = symbol.toUpperCase();
  const [versions, runs, triggers, tbill, closes, summary] = await Promise.all([
    ValuationAssumptionModel.find({ userId, symbol: sym }).sort({ version: -1 }).limit(40).lean() as Promise<any[]>,
    ValuationRunModel.find({ userId, symbol: sym }).sort({ date: -1 }).limit(120).lean() as Promise<any[]>,
    ValuationTriggerModel.find({ userId, symbol: sym }).sort({ createdAt: -1 }).lean() as Promise<any[]>,
    getTbill12mPct().catch(() => null),
    latestCloses().catch(() => new Map<string, { date: string; close: number }>()),
    getPortfolioSummary().catch(() => null),
  ]);
  const approved = versions.find((v) => v.status === "approved") ?? null;
  const draft = versions.find((v) => v.status === "draft") ?? null;
  const price = closes.get(sym)?.close ?? null;
  const held = (summary?.positions ?? []).some((p) => p.symbol === sym && p.shares > 0);
  const since = approved?.asOf ?? "1970-01-01";
  const filings = ((await AnnouncementModel.find({ symbol: sym, kind: "results" }, { title: 1, announcedAt: 1, pdfPath: 1 }).sort({ announcedAt: -1 }).limit(6).lean()) as any[]).map((a) => ({
    title: a.title,
    date: new Date(a.announcedAt).toISOString().slice(0, 10),
    url: a.pdfPath ? `https://dps.psx.com.pk${a.pdfPath}` : null,
    after: isResultsLetter(a.title ?? "") && new Date(a.announcedAt).toISOString().slice(0, 10) > since,
  }));
  // Today's valuation of the version being looked at (a draft before it is
  // approved), on the latest close and the T-bill.
  const prices = new Map([...closes].map(([s, c]) => [s, c.close]));
  const preview = (doc: any): Valuation | null => (doc && price && tbill != null ? value(toAssumption(doc), { price, tbillPct: tbill, held, stale: false, prices }) : null);
  const suggested = !approved && !draft ? await suggestion(sym) : null;
  return {
    symbol: sym,
    name: listings().find((l) => l.symbol === sym)?.name ?? sym,
    held,
    price,
    priceDate: closes.get(sym)?.date ?? null,
    tbill,
    approved,
    draft,
    suggested,
    versions,
    run: runs[0] ?? null,
    history: runs.slice(0, 60).reverse().map((r) => ({ date: r.date, price: r.price, fair: r.fairValue, signal: r.signal })),
    triggers: triggers.map((t) => ({ id: String(t._id), metric: t.metric, op: t.op, threshold: t.threshold, action: t.action, note: t.note, active: t.active, lastFiredAt: t.lastFiredAt })),
    filings,
    closes: Object.fromEntries(prices),
    draftPreview: preview(draft),
    approvedPreview: preview(approved),
    suggestedPreview: suggested ? preview({ ...suggested, version: 0, asOf: suggested.asOf }) : null,
  };
}
