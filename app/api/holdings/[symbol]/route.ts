import { NextRequest, NextResponse } from "next/server";
import { uid } from "@/lib/auth/uid";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { HoldingModel, TransactionModel } from "@/lib/models";
import { getCompanyInfo } from "@/lib/prices";

export const dynamic = "force-dynamic";

const metricSchema = z.object({
  name: z.string().default(""),
  source: z.string().default(""),
  green: z.string().default(""),
  red: z.string().default(""),
  current: z.string().default(""),
});

const patchSchema = z.object({
  name: z.string().optional(),
  sector: z.string().optional(),
  shariaCompliant: z.boolean().optional(),
  targetAllocationPercent: z.number().min(0).max(100).optional(),
  rebalanceBand: z.number().min(0).max(50).optional(),
  targetRationale: z.string().optional(),
  standsInFor: z.string().max(12).optional(),
  notes: z.string().optional(),
  parked: z.boolean().optional(),
  parkedNote: z.string().max(200).optional(),
  refreshFromPSX: z.boolean().optional(),
  // Playbook
  tier: z.string().optional(),
  convictionScore: z.number().min(0).max(25).optional(),
  goalTag: z.string().optional(),
  thesis: z.string().optional(),
  trackedMetrics: z.array(metricSchema).optional(),
  modelAssumptions: z
    .object({
      mode: z.enum(["eps", "nav"]).optional(),
      annualGrowth: z.number().optional(),
      peStart: z.number().optional(),
      peEnd: z.number().optional(),
      payoutRatio: z.number().optional(),
      navDiscount: z.number().optional(),
      horizonYears: z.number().optional(),
      useDRIP: z.boolean().optional(),
      saved: z.boolean().optional(),
    })
    .optional(),
  dividendOverride: z
    .object({
      parValue: z.number().min(0).optional(),
      cadence: z.enum(["", "annual", "semi-annual", "quarterly"]).optional(),
      payoutRatioPct: z.number().min(0).max(500).optional(),
      expectedAnnualDps: z.number().min(0).optional(),
    })
    .optional(),
  bookValuePerShare: z.number().min(0).optional(),
  purificationPctOfDividend: z.number().min(0).max(100).optional(),
  // The sell-discipline plan. Counters are SERVER-managed (see PATCH) — the
  // client cannot reset its own goalpost-moving history.
  plan: z
    .object({
      classification: z.enum(["", "compounder", "stalwart", "cyclical", "asset_play", "turnaround", "value_trap"]).default(""),
      fvLow: z.number().min(0).default(0),
      fvBase: z.number().min(0).default(0),
      fvHigh: z.number().min(0).default(0),
      fvMethod: z.string().max(200).default(""),
      invalidators: z.array(z.object({ text: z.string().max(300), occurredAt: z.string().default("") })).max(12).default([]),
      timeStopMonths: z.number().min(0).max(120).default(0),
      cumOcf3y: z.number().nullable().default(null),
      openedAt: z.string().default(""),
    })
    .optional(),
  rebuyRule: z
    .object({
      active: z.boolean().default(false),
      maxPrice: z.number().min(0).default(0),
      requiredConditions: z.array(z.string().max(300)).max(8).default([]),
      reviewOn: z.string().default(""),
    })
    .optional(),
  // The company's own audited fair-value assumptions, transcribed with citation.
  disclosedValuation: z
    .object({
      requiredReturnPct: z.number().min(0).max(60).default(0),
      growthPct: z.number().min(0).max(30).default(0),
      baseDps: z.number().min(0).default(0),
      source: z.string().max(300).default(""),
      asOf: z.string().default(""),
    })
    .optional(),
  lookThrough: z
    .object({
      enabled: z.boolean().optional(),
      constituents: z
        .array(z.object({ label: z.string().default(""), symbol: z.string().default(""), shares: z.number().min(0).default(0), ownershipPct: z.number().min(0).max(100).default(0) }))
        .max(60)
        .optional(),
      unlistedHoldings: z
        .array(z.object({ label: z.string().default(""), valuePkr: z.number().default(0), ownershipPct: z.number().min(0).max(100).default(0), note: z.string().default("") }))
        .max(60)
        .optional(),
      unlistedValuePkr: z.number().optional(),
      netDebtPkr: z.number().optional(),
      sharesOutstanding: z.number().min(0).optional(),
    })
    .optional(),
});

type Params = { params: Promise<{ symbol: string }> };

export async function GET(_req: NextRequest, props: Params) {
  const params = await props.params;
  await connectDb();
  const doc = await HoldingModel.findOne({ userId: await uid(), symbol: params.symbol.toUpperCase() }).lean();
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(doc);
}

export async function PATCH(req: NextRequest, props: Params) {
  const params = await props.params;
  try {
    const symbol = params.symbol.toUpperCase();
    const body = await req.json();
    const parsed = patchSchema.parse(body);
    await connectDb();

    const update: Record<string, unknown> = { ...parsed };
    delete update.refreshFromPSX;

    // Behavioural-guard counters — maintained HERE so the client can't garden
    // its own history. A raised ceiling/target and every thesis edit is counted;
    // the escalation and drift guards read these against the decision log.
    const existing = await HoldingModel.findOne({ userId: await uid(), symbol }).lean();
    if (existing) {
      const ex: any = existing;
      if (parsed.plan) {
        const prevPlan: any = ex.plan ?? {};
        const merged: any = { ...prevPlan, ...parsed.plan };
        merged.fvHighRaisedCount = prevPlan.fvHighRaisedCount ?? 0;
        merged.targetRaisedCount = prevPlan.targetRaisedCount ?? 0;
        merged.thesisEditCount = prevPlan.thesisEditCount ?? 0;
        if (prevPlan.fvHigh > 0 && parsed.plan.fvHigh > prevPlan.fvHigh) merged.fvHighRaisedCount += 1;
        if (parsed.plan.fvHigh !== prevPlan.fvHigh || parsed.plan.fvBase !== prevPlan.fvBase || parsed.plan.fvLow !== prevPlan.fvLow) {
          merged.fvUpdatedAt = new Date().toISOString().slice(0, 10);
        }
        if (!merged.openedAt) merged.openedAt = prevPlan.openedAt ?? "";
        merged.lastReviewedAt = new Date().toISOString().slice(0, 10);
        merged.cumOcf3y = parsed.plan.cumOcf3y ?? null;
        update.plan = merged;
      }
      if (
        parsed.targetAllocationPercent != null &&
        (ex.targetAllocationPercent ?? 0) > 0 &&
        parsed.targetAllocationPercent > (ex.targetAllocationPercent ?? 0)
      ) {
        (update as any)["plan.targetRaisedCount"] = ((ex.plan?.targetRaisedCount ?? 0) as number) + 1;
        if (update.plan) (update.plan as any).targetRaisedCount = ((ex.plan?.targetRaisedCount ?? 0) as number) + 1;
      }
      if (parsed.thesis != null && parsed.thesis !== (ex.thesis ?? "") && (ex.thesis ?? "") !== "") {
        if (update.plan) (update.plan as any).thesisEditCount = ((ex.plan?.thesisEditCount ?? 0) as number) + 1;
        else (update as any)["plan.thesisEditCount"] = ((ex.plan?.thesisEditCount ?? 0) as number) + 1;
      }
    }

    if (parsed.refreshFromPSX) {
      const info = await getCompanyInfo(symbol);
      if (info) {
        if (info.name && !parsed.name) update.name = info.name;
        if (info.sector && !parsed.sector) update.sector = info.sector;
      }
    }

    const updated = await HoldingModel.findOneAndUpdate({ userId: await uid(), symbol }, update, { new: true }).lean();
    if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, props: Params) {
  const params = await props.params;
  await connectDb();
  const symbol = params.symbol.toUpperCase();
  const txCount = await TransactionModel.countDocuments({ userId: await uid(), symbol, deletedAt: null });
  if (txCount > 0) {
    return NextResponse.json(
      { error: "has_transactions", count: txCount, message: "Delete this holding's transactions first." },
      { status: 400 }
    );
  }
  const deleted = await HoldingModel.findOneAndDelete({ userId: await uid(), symbol }).lean();
  if (!deleted) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ deleted: true, symbol });
}
