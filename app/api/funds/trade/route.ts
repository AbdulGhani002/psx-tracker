import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { uid } from "@/lib/auth/uid";
import { connectDb } from "@/lib/db";
import { MutualFundModel } from "@/lib/models";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A mutual fund trade from the Add trade form: buy or redeem units of a fund,
// found by id or by its MUFAP name (created on the first buy). The position's
// units and average cost move; the trade is appended to the fund's record.

const schema = z.object({
  fundId: z.string().optional(),
  fund: z.object({ name: z.string().min(1), mufapName: z.string().min(1), amc: z.string().default(""), moneyMarket: z.boolean().default(false) }).optional(),
  side: z.enum(["BUY", "REDEEM"]),
  units: z.number().positive().optional(),
  amount: z.number().positive().optional(),
  nav: z.number().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(300).default(""),
  portfolioId: z.string().optional(),
});

const daysBetween = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000));

export async function POST(req: NextRequest) {
  try {
    const parsed = schema.parse(await req.json());
    const units = parsed.units ?? (parsed.amount ? parsed.amount / parsed.nav : 0);
    if (!(units > 0)) return NextResponse.json({ error: "invalid", detail: "Give units or an amount." }, { status: 400 });
    await connectDb();
    const userId = await uid();
    const { selectedPortfolio, defaultPortfolio } = await import("@/lib/portfolios");
    const portfolioId = parsed.portfolioId || (await selectedPortfolio())?._id || (await defaultPortfolio())?._id || "";

    let doc = parsed.fundId ? await MutualFundModel.findOne({ _id: parsed.fundId, userId }) : null;
    if (!doc && parsed.fund) doc = await MutualFundModel.findOne({ userId, mufapName: parsed.fund.mufapName, ...(portfolioId ? { portfolioId: { $in: [portfolioId, "", null] } } : {}) });
    if (!doc) {
      if (parsed.side === "REDEEM") return NextResponse.json({ error: "not_held", detail: "You do not hold this fund." }, { status: 400 });
      if (!parsed.fund) return NextResponse.json({ error: "invalid", detail: "Pick a fund." }, { status: 400 });
      doc = new MutualFundModel({ userId, portfolioId, name: parsed.fund.name, mufapName: parsed.fund.mufapName, amc: parsed.fund.amc, units: 0, avgCost: parsed.nav, fundType: "growth", moneyMarket: parsed.fund.moneyMarket, annualYieldPct: 0, anchorDate: "" });
    }

    // Daily-dividend funds keep their units at par and grow from the anchor;
    // bring the units up to the trade date, then move the anchor there.
    const d = doc as any;
    let base = Number(d.units) || 0;
    const daily = d.fundType === "dailyDividend" && d.anchorDate && (d.annualYieldPct ?? 0) > 0;
    if (daily) {
      const factor = Math.pow(1 + d.annualYieldPct / 100, 1 / 365);
      base = base * Math.pow(factor, daysBetween(d.anchorDate, parsed.date));
    }
    if (parsed.side === "REDEEM" && units > base + 1e-6) {
      return NextResponse.json({ error: "oversell", detail: `You hold ${base.toFixed(4)} units; cannot redeem ${units.toFixed(4)}.` }, { status: 400 });
    }
    const amount = units * parsed.nav;
    let realizedGain = 0;
    if (parsed.side === "BUY") {
      const newUnits = base + units;
      d.avgCost = newUnits > 0 ? (base * (Number(d.avgCost) || parsed.nav) + units * parsed.nav) / newUnits : parsed.nav;
      d.units = newUnits;
    } else {
      realizedGain = amount - units * (Number(d.avgCost) || 0);
      d.units = Math.max(0, base - units);
    }
    if (daily) d.anchorDate = parsed.date;
    d.trades = [...(d.trades ?? []), { date: new Date(parsed.date), side: parsed.side, units, nav: parsed.nav, amount, realizedGain, notes: parsed.notes }];
    await doc.save();
    return NextResponse.json({ ok: true, fund: doc.toObject(), units, amount }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}
