import { getCurrentUserId } from "@/lib/auth/current-user";
import { connectDb } from "@/lib/db";
import { HoldingModel, TransactionModel, FundamentalModel, ShareEventModel } from "@/lib/models";
import { currentFace, faceOf, type FaceEvent } from "@/lib/calculations/face-value";
import { deriveFromTransactions } from "@/lib/calculations/holding";
import { listPortfolios } from "@/lib/portfolios";
import { getAppSettings } from "@/lib/data";
import { planDueActions, autoSettingsFrom, financialYearLabel, cycleLabel, dividendFigures, bonusFigures, actionKeyOf, type SymbolPayouts, type DueAction, type Skipped } from "@/lib/calculations/corporate-actions";

export * from "@/lib/calculations/corporate-actions";

// The database side of the automatic recording: read the ledger and the
// payout boards, write what is due, report what was written. The arithmetic
// lives in lib/calculations/corporate-actions.ts, which has no server imports
// so the tests can run it.

const isoDay = (d: Date | string) => (typeof d === "string" ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10));
const round2 = (v: number) => Math.round(v * 100 + 1e-9) / 100;
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Each name's cash dividends as the closing files took them off the price.
async function cashEvents(symbols: string[], from = "2000-01-01"): Promise<Map<string, FaceEvent[]>> {
  const rows = (await ShareEventModel.find({ symbol: { $in: symbols }, kind: "cash", date: { $gte: from } }, { symbol: 1, date: 1, cash: 1 }).lean()) as any[];
  const out = new Map<string, FaceEvent[]>();
  for (const r of rows) {
    const list = out.get(r.symbol) ?? [];
    list.push({ date: String(r.date), cash: Number(r.cash) });
    out.set(r.symbol, list);
  }
  return out;
}

async function recomputeHolding(userId: string, symbol: string) {
  const txs = await TransactionModel.find({ userId, symbol, deletedAt: null }).sort({ date: 1, createdAt: 1 }).lean();
  const d = deriveFromTransactions(txs as any);
  await HoldingModel.findOneAndUpdate({ userId, symbol }, { currentShares: d.shares, avgCostBasis: d.avgCost, totalCost: d.totalCost, realizedPL: d.realizedPL, totalDividendsReceived: d.dividendsReceived });
}

export type RunResult = { recorded: Array<DueAction & { id: string }>; skipped: Skipped[]; checked: number };

// Writes what is due for the current user. Idempotent: the action key is
// unique per user, so a second run in the same day writes nothing.
export async function runCorporateActionsForCurrentUser(opts: { today?: string; dryRun?: boolean } = {}): Promise<RunResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { recorded: [], skipped: [], checked: 0 };
  await connectDb();
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const [settingsRaw, holdings, liveTxs, keyed, portfolios] = await Promise.all([
    getAppSettings(),
    HoldingModel.find({ userId }).lean(),
    TransactionModel.find({ userId, deletedAt: null }).lean(),
    TransactionModel.find({ userId, actionKey: { $type: "string" } }, { actionKey: 1 }).lean(),
    listPortfolios().catch(() => []),
  ]);
  const settings = autoSettingsFrom(settingsRaw);
  const symbols = [...new Set((holdings as any[]).map((h) => h.symbol as string))];
  if (symbols.length === 0) return { recorded: [], skipped: [], checked: 0 };
  const [funds, events] = await Promise.all([FundamentalModel.find({ symbol: { $in: symbols } }).lean() as Promise<any[]>, cashEvents(symbols, addDays(today, -400))]);
  const boards: SymbolPayouts[] = funds.map((f) => ({ symbol: f.symbol, faceValue: f.faceValue ?? 10, payouts: f.payouts ?? [], events: events.get(f.symbol) ?? [] }));
  const defaultPortfolioId = portfolios.find((p) => p.isDefault)?._id ?? portfolios[0]?._id ?? "";
  const { due, skipped } = planDueActions({ liveTxs: liveTxs as any, usedKeys: new Set((keyed as any[]).map((k) => k.actionKey)), boards, settings, defaultPortfolioId, today });

  const recorded: RunResult["recorded"] = [];
  if (opts.dryRun) return { recorded: due.map((d) => ({ ...d, id: "" })), skipped, checked: boards.length };
  const touched = new Set<string>();
  for (const a of due) {
    const fy = financialYearLabel(a.bookClosure);
    const doc =
      a.type === "DIVIDEND"
        ? {
            userId, portfolioId: a.portfolioId, symbol: a.symbol, type: "DIVIDEND", date: new Date(a.bookClosure + "T00:00:00Z"),
            shares: a.shares, pricePerShare: a.rate, totalAmount: a.gross, fees: round2(a.tax + a.zakat), netAmount: a.net,
            taxDeducted: a.tax, zakatDeducted: a.zakat, financialYear: fy, dividendType: cycleLabel(a.cycle),
            notes: `${cycleLabel(a.cycle) || "Cash"} dividend ${a.pctOfFace}% FY${fy}, recorded from the PSX announcement; the warrant replaces these figures when uploaded`,
            source: "auto", actionKey: a.actionKey,
          }
        : {
            userId, portfolioId: a.portfolioId, symbol: a.symbol, type: "BONUS", date: new Date(a.bookClosure + "T00:00:00Z"),
            shares: a.bonusCredited, pricePerShare: 0, totalAmount: 0, fees: 0, netAmount: 0,
            notes: `Bonus ${a.pctOfFace}% on ${a.shares.toLocaleString()} shares, recorded from the PSX announcement${a.bonusWithheld > 0 ? `; ${a.bonusWithheld} share${a.bonusWithheld === 1 ? "" : "s"} withheld for tax` : ""}`,
            source: "auto", actionKey: a.actionKey,
          };
    try {
      const created = await TransactionModel.create(doc);
      recorded.push({ ...a, id: String(created._id) });
      touched.add(a.symbol);
    } catch (e: any) {
      if (e?.code !== 11000) throw e; // a duplicate key means another run got there first
    }
  }
  for (const s of touched) await recomputeHolding(userId, s);
  return { recorded, skipped, checked: boards.length };
}

export type Announced = {
  symbol: string;
  type: "DIVIDEND" | "BONUS" | "RIGHT";
  bookClosure: string;
  pctOfFace: number;
  cycle: string;
  shares: number; // held today
  rate: number;
  gross: number;
  net: number;
  bonusCredited: number;
  status: "upcoming" | "recorded" | "past";
};

// What the board says is coming for the names held today, and what the job
// has already written, for the Payouts tab.
export async function getAnnouncedActions(daysAhead = 90): Promise<{ upcoming: Announced[]; recorded: Array<{ id: string; symbol: string; type: string; date: string; shares: number; rate: number; net: number; notes: string }> }> {
  const userId = await getCurrentUserId();
  if (!userId) return { upcoming: [], recorded: [] };
  await connectDb();
  const [settingsRaw, holdings, autoRows] = await Promise.all([
    getAppSettings(),
    HoldingModel.find({ userId, currentShares: { $gt: 0 }, parked: { $ne: true } }).lean(),
    TransactionModel.find({ userId, source: "auto", deletedAt: null }).sort({ date: -1 }).limit(20).lean(),
  ]);
  const settings = autoSettingsFrom(settingsRaw);
  const held = new Map((holdings as any[]).map((h) => [h.symbol as string, h.currentShares as number]));
  const funds: any[] = held.size ? await FundamentalModel.find({ symbol: { $in: [...held.keys()] } }).lean() : [];
  const today = new Date().toISOString().slice(0, 10);
  const events = held.size ? await cashEvents([...held.keys()], addDays(today, -60)) : new Map<string, FaceEvent[]>();
  const end = addDays(today, daysAhead);
  const from = addDays(today, -30);
  const keys = new Set((autoRows as any[]).map((r) => r.actionKey).filter(Boolean));
  const upcoming: Announced[] = [];
  for (const f of funds) {
    for (const p of f.payouts ?? []) {
      const bc = p.bookClosure;
      if (!bc || bc < from || bc > end || !(p.pctOfFace > 0)) continue;
      const type = p.payoutType === "cash" ? "DIVIDEND" : p.payoutType === "bonus" ? "BONUS" : p.payoutType === "right" ? "RIGHT" : null;
      if (!type) continue;
      const shares = held.get(f.symbol) ?? 0;
      const fv = (type === "DIVIDEND" ? faceOf(p, events.get(f.symbol) ?? [])?.face : null) ?? f.faceValue ?? 10;
      const d = type === "DIVIDEND" ? dividendFigures(shares, p.pctOfFace, fv, settings) : { rate: round2((p.pctOfFace * fv) / 100), gross: 0, net: 0 };
      const bo = type === "BONUS" ? bonusFigures(shares, p.pctOfFace, settings) : { credited: 0 };
      const key = actionKeyOf(f.symbol, type, bc, p.pctOfFace);
      upcoming.push({ symbol: f.symbol, type, bookClosure: bc, pctOfFace: p.pctOfFace, cycle: p.cycle ?? "", shares, rate: d.rate, gross: d.gross, net: d.net, bonusCredited: bo.credited, status: keys.has(key) ? "recorded" : bc > today ? "upcoming" : "past" });
    }
  }
  upcoming.sort((a, b) => a.bookClosure.localeCompare(b.bookClosure));
  const recorded = (autoRows as any[]).map((r) => ({ id: String(r._id), symbol: r.symbol, type: r.type, date: isoDay(r.date), shares: r.shares, rate: r.pricePerShare, net: r.netAmount, notes: r.notes ?? "" }));
  return { upcoming, recorded };
}

// Every company's face value from its newest cash dividend the closing files
// show (lib/calculations/face-value), where that differs from the one kept.
export async function checkFaceValues(opts: { dryRun?: boolean; today?: string } = {}): Promise<{ checked: number; changed: Array<{ symbol: string; from: number; to: number; proof: string }> }> {
  await connectDb();
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const funds = (await FundamentalModel.find({ "payouts.0": { $exists: true } }, { symbol: 1, faceValue: 1, payouts: 1 }).lean()) as any[];
  const events = await cashEvents(funds.map((f) => f.symbol));
  const changed: Array<{ symbol: string; from: number; to: number; proof: string }> = [];
  let checked = 0;
  for (const f of funds) {
    const c = currentFace(f.payouts ?? [], events.get(f.symbol) ?? [], today);
    if (!c) continue;
    checked++;
    if (c.face === f.faceValue) continue;
    changed.push({ symbol: f.symbol, from: f.faceValue, to: c.face, proof: `Rs ${c.cash} off the price for ${c.pct}% (book closure ${c.bookClosure})` });
    if (!opts.dryRun) await FundamentalModel.updateOne({ _id: f._id }, { $set: { faceValue: c.face } });
  }
  return { checked, changed };
}

// Dividends the job wrote at a rate the ex-date does not bear out (a face
// value kept wrong at the time): set to the rate the closing file shows,
// with the row's own tax rate, for every user. Rows entered by hand are
// left alone.
export async function fixAutoDividends(opts: { dryRun?: boolean } = {}): Promise<Array<{ userId: string; symbol: string; date: string; shares: number; was: number; now: number; gross: number; net: number }>> {
  await connectDb();
  const rows = (await TransactionModel.find({ type: "DIVIDEND", source: "auto", deletedAt: null, actionKey: { $regex: ":DIVIDEND:" } }).lean()) as any[];
  const events = await cashEvents([...new Set(rows.map((r) => String(r.symbol)))]);
  const out: Array<{ userId: string; symbol: string; date: string; shares: number; was: number; now: number; gross: number; net: number }> = [];
  const touched = new Set<string>();
  for (const r of rows) {
    const [, , bookClosure, pctText] = String(r.actionKey).split(":");
    const pct = Number(pctText);
    const m = faceOf({ bookClosure, pctOfFace: pct, payoutType: "cash" }, events.get(r.symbol) ?? []);
    if (!m) continue;
    const rate = round2((pct * m.face) / 100);
    if (Math.abs(Number(r.pricePerShare) - rate) <= 0.011) continue;
    const taxPct = Number(r.totalAmount) > 0 ? Math.round((Number(r.taxDeducted) / Number(r.totalAmount)) * 200) / 2 : 15;
    const d = dividendFigures(Number(r.shares), pct, m.face, { autoDividends: true, autoBonus: true, dividendWhtPct: taxPct, zakatOnDividends: Number(r.zakatDeducted) > 0 ? "paidUp" : "none", bonusTaxWithheld: false, bonusTaxPct: 0 });
    out.push({ userId: String(r.userId), symbol: r.symbol, date: isoDay(r.date), shares: Number(r.shares), was: Number(r.pricePerShare), now: d.rate, gross: d.gross, net: d.net });
    if (opts.dryRun) continue;
    const note = ` Rate corrected ${new Date().toISOString().slice(0, 10)}: Rs ${d.rate} a share on a Rs ${m.face} face value (the exchange took Rs ${m.event.cash} off the price on ${m.event.date}).`;
    await TransactionModel.updateOne(
      { _id: r._id },
      { $set: { pricePerShare: d.rate, totalAmount: d.gross, taxDeducted: d.tax, zakatDeducted: d.zakat, fees: round2(d.tax + d.zakat), netAmount: d.net, notes: `${r.notes ?? ""}${note}`.trim() } }
    );
    touched.add(`${r.userId}|${r.symbol}`);
  }
  for (const k of touched) {
    const [userId, symbol] = k.split("|");
    await recomputeHolding(userId, symbol);
  }
  return out;
}
