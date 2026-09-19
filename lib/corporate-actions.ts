import { getCurrentUserId } from "@/lib/auth/current-user";
import { connectDb } from "@/lib/db";
import { HoldingModel, TransactionModel, FundamentalModel } from "@/lib/models";
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
  const funds: any[] = await FundamentalModel.find({ symbol: { $in: symbols } }).lean();
  const boards: SymbolPayouts[] = funds.map((f) => ({ symbol: f.symbol, faceValue: f.faceValue ?? 10, payouts: f.payouts ?? [] }));
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
      const fv = f.faceValue ?? 10;
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
