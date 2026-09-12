// Which portfolio the pages are looking at.
//
// The selection lives in a cookie ("pf": a portfolio id, or "all"). Every
// reader that filters by portfolio asks `portfolioFilter()` for the Mongo
// condition to add: nothing for the consolidated view, an $in that also
// catches the rows written before portfolios existed for the default one,
// and an exact match otherwise. Background jobs (the cron, the report) see
// the consolidated book: they never carry the cookie.

import "server-only";
import { cookies } from "next/headers";
import { connectDb } from "@/lib/db";
import { PortfolioModel, type Portfolio } from "@/lib/models/Portfolio";
import { getCurrentUserId } from "@/lib/auth/current-user";

export const PORTFOLIO_COOKIE = "pf";
export const ALL = "all";

export type PortfolioView = { _id: string; name: string; broker: string; kind: string; color: string; isDefault: boolean; notes: string };

const PALETTE = ["#22c55e", "#3b82f6", "#a78bfa", "#f59e0b", "#22d3ee", "#f472b6", "#a3e635", "#94a3b8"];

function plain(p: any): PortfolioView {
  return { _id: String(p._id), name: p.name, broker: p.broker ?? "", kind: p.kind ?? "mixed", color: p.color || PALETTE[0], isDefault: !!p.isDefault, notes: p.notes ?? "" };
}

// Every portfolio the user has; the default one is created on first read so
// the switcher always has something to show.
export async function listPortfolios(): Promise<PortfolioView[]> {
  const uid = await getCurrentUserId();
  if (!uid) return [];
  await connectDb();
  let docs = await PortfolioModel.find({ userId: uid }).sort({ isDefault: -1, createdAt: 1 }).lean();
  if (docs.length === 0) {
    // One atomic upsert, so concurrent first reads cannot each create one.
    await PortfolioModel.updateOne({ userId: uid, name: "Main" }, { $setOnInsert: { userId: uid, name: "Main", broker: "", kind: "mixed", color: PALETTE[0], isDefault: true, notes: "" } }, { upsert: true });
    docs = await PortfolioModel.find({ userId: uid }).sort({ isDefault: -1, createdAt: 1 }).lean();
  }
  // Duplicates from before the upsert (same name, no rows pointing at them)
  // are folded into the oldest.
  const seen = new Map<string, any>();
  const extras: any[] = [];
  for (const d of docs) {
    const k = String(d.name).toLowerCase();
    if (seen.has(k)) extras.push(d);
    else seen.set(k, d);
  }
  if (extras.length) {
    await PortfolioModel.deleteMany({ _id: { $in: extras.map((e) => e._id) } }).catch(() => {});
    docs = docs.filter((d) => !extras.some((e) => String(e._id) === String(d._id)));
  }
  if (!docs.some((d) => (d as any).isDefault) && docs.length) {
    await PortfolioModel.updateOne({ _id: docs[0]._id }, { $set: { isDefault: true } }).catch(() => {});
    (docs[0] as any).isDefault = true;
  }
  return docs.map((d, i) => ({ ...plain(d), color: (d as any).color || PALETTE[i % PALETTE.length] }));
}

export async function defaultPortfolio(): Promise<PortfolioView | null> {
  const all = await listPortfolios();
  return all.find((p) => p.isDefault) ?? all[0] ?? null;
}

// The selected portfolio: null means the consolidated view.
export async function selectedPortfolio(): Promise<PortfolioView | null> {
  let raw = "";
  try {
    raw = cookies().get(PORTFOLIO_COOKIE)?.value ?? "";
  } catch {
    return null; // no request scope: a job, which sees everything
  }
  if (!raw || raw === ALL) return null;
  const all = await listPortfolios();
  return all.find((p) => p._id === raw) ?? null;
}

// The Mongo condition for the current selection, to spread into a query.
export async function portfolioFilter(): Promise<Record<string, unknown>> {
  const sel = await selectedPortfolio();
  if (!sel) return {};
  return sel.isDefault ? { portfolioId: { $in: [sel._id, "", null] } } : { portfolioId: sel._id };
}

// The same, for a portfolio named explicitly (the overview's per-portfolio cards).
export function filterFor(p: PortfolioView): Record<string, unknown> {
  return p.isDefault ? { portfolioId: { $in: [p._id, "", null] } } : { portfolioId: p._id };
}

export async function createPortfolio(input: { name: string; broker?: string; kind?: string; color?: string; notes?: string }): Promise<PortfolioView> {
  const uid = await getCurrentUserId();
  if (!uid) throw new Error("not signed in");
  await connectDb();
  const count = await PortfolioModel.countDocuments({ userId: uid });
  const doc = await PortfolioModel.create({ userId: uid, name: input.name.trim(), broker: input.broker ?? "", kind: input.kind ?? "mixed", color: input.color || PALETTE[count % PALETTE.length], notes: input.notes ?? "", isDefault: count === 0 });
  return plain(doc.toObject());
}

export async function updatePortfolio(id: string, patch: Partial<{ name: string; broker: string; kind: string; color: string; notes: string; isDefault: boolean }>): Promise<PortfolioView | null> {
  const uid = await getCurrentUserId();
  if (!uid) throw new Error("not signed in");
  await connectDb();
  if (patch.isDefault) await PortfolioModel.updateMany({ userId: uid }, { $set: { isDefault: false } });
  const doc = await PortfolioModel.findOneAndUpdate({ _id: id, userId: uid }, { $set: patch }, { new: true }).lean();
  return doc ? plain(doc) : null;
}

// A portfolio can go only when nothing points at it; the rows are moved to the
// default portfolio first by the caller, or the delete is refused.
export async function deletePortfolio(id: string): Promise<{ ok: boolean; reason?: string }> {
  const uid = await getCurrentUserId();
  if (!uid) throw new Error("not signed in");
  await connectDb();
  const doc = await PortfolioModel.findOne({ _id: id, userId: uid }).lean();
  if (!doc) return { ok: false, reason: "not found" };
  if ((doc as any).isDefault) return { ok: false, reason: "the default portfolio cannot be deleted" };
  const { TransactionModel } = await import("@/lib/models/Transaction");
  const { CashEntryModel } = await import("@/lib/models/CashEntry");
  const { MutualFundModel } = await import("@/lib/models/MutualFund");
  const { SavingsAccountModel } = await import("@/lib/models/SavingsAccount");
  const used = (await TransactionModel.countDocuments({ userId: uid, portfolioId: id })) + (await CashEntryModel.countDocuments({ userId: uid, portfolioId: id })) + (await MutualFundModel.countDocuments({ userId: uid, portfolioId: id })) + (await SavingsAccountModel.countDocuments({ userId: uid, portfolioId: id }));
  if (used > 0) return { ok: false, reason: `${used} rows still belong to it; move them first` };
  await PortfolioModel.deleteOne({ _id: id, userId: uid });
  return { ok: true };
}
