import { NextResponse } from "next/server";
import { z } from "zod";
import { cronAuthorised } from "@/lib/auth/cron";
import { connectDb } from "@/lib/db";
import { runAsUser } from "@/lib/auth/current-user";
import { getAllUserIds } from "@/lib/data";
import { HoldingModel, TransactionModel } from "@/lib/models";
import { deriveFromTransactions } from "@/lib/calculations";
import { getCompanyInfo } from "@/lib/prices";
import { listings } from "@/lib/listings";
import { selectedPortfolio, defaultPortfolio } from "@/lib/portfolios";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Machine-only: a broker statement's buys and sells for one user, written as
// the Add trade form writes them (a holding made for a new share, the trade,
// the holding worked out again). A trade whose note is already on the ledger
// is left alone, so a statement can be sent twice. Body {user: n, trades}.

const trade = z.object({
  symbol: z.string().min(1).transform((s) => s.toUpperCase().trim()),
  type: z.enum(["BUY", "SELL"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shares: z.number().positive(),
  pricePerShare: z.number().positive(),
  fees: z.number().min(0).default(0),
  notes: z.string().min(1),
});
const body = z.object({ user: z.number().int().min(0).default(0), trades: z.array(trade).min(1).max(50) });

export async function POST(req: Request) {
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let p: z.infer<typeof body>;
  try {
    p = body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "invalid", detail: String(e).slice(0, 300) }, { status: 400 });
  }
  await connectDb();
  const ids = await getAllUserIds();
  const userId = ids[Math.min(ids.length - 1, p.user)];
  if (!userId) return NextResponse.json({ ok: false, error: "no users" });
  const out = await runAsUser(userId, async () => {
    const portfolioId = (await selectedPortfolio())?._id ?? (await defaultPortfolio())?._id ?? "";
    const rows: Array<Record<string, unknown>> = [];
    const touched = new Set<string>();
    for (const t of p.trades) {
      if (await TransactionModel.exists({ userId, symbol: t.symbol, notes: t.notes, deletedAt: null })) {
        rows.push({ symbol: t.symbol, notes: t.notes, status: "already on the ledger" });
        continue;
      }
      if (t.type === "SELL") {
        const held = deriveFromTransactions((await TransactionModel.find({ userId, symbol: t.symbol, deletedAt: null }).lean()) as any).shares;
        if (t.shares > held + 1e-6) {
          rows.push({ symbol: t.symbol, notes: t.notes, status: `not written: ${held} held` });
          continue;
        }
      }
      let holding = await HoldingModel.findOne({ userId, symbol: t.symbol });
      if (!holding) {
        const info = await getCompanyInfo(t.symbol).catch(() => null);
        const listed = listings().find((l) => l.symbol === t.symbol);
        holding = await HoldingModel.create({ userId, symbol: t.symbol, name: info?.name ?? listed?.name ?? t.symbol, sector: info?.sector ?? listed?.sectorName ?? "Unknown", shariaCompliant: false });
      }
      const totalAmount = t.shares * t.pricePerShare;
      const created = await TransactionModel.create({
        userId,
        portfolioId,
        symbol: t.symbol,
        type: t.type,
        date: new Date(t.date),
        shares: t.type === "SELL" ? -t.shares : t.shares,
        pricePerShare: t.pricePerShare,
        totalAmount,
        fees: t.fees,
        netAmount: t.type === "BUY" ? totalAmount + t.fees : totalAmount - t.fees,
        notes: t.notes,
        ratio: "",
      });
      touched.add(t.symbol);
      rows.push({ symbol: t.symbol, notes: t.notes, status: "written", id: String(created._id), netAmount: Math.round(Number(created.netAmount) * 100) / 100, parked: !!(holding as any).parked });
    }
    for (const symbol of touched) {
      const d = deriveFromTransactions((await TransactionModel.find({ userId, symbol, deletedAt: null }).sort({ date: 1, createdAt: 1 }).lean()) as any);
      await HoldingModel.findOneAndUpdate({ userId, symbol }, { currentShares: d.shares, avgCostBasis: d.avgCost, totalCost: d.totalCost, realizedPL: d.realizedPL, totalDividendsReceived: d.dividendsReceived });
      rows.filter((r) => r.symbol === symbol).forEach((r) => Object.assign(r, { sharesNow: d.shares, avgCost: Math.round(d.avgCost * 100) / 100 }));
    }
    return { rows };
  });
  return NextResponse.json({ ok: true, ...out });
}
