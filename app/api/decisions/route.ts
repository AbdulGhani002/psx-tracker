import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { uid } from "@/lib/auth/uid";
import { DecisionModel } from "@/lib/models";
import { snapshotForDecision } from "@/lib/data-decisions";
import { detectCostAnchoring } from "@/lib/calculations/sell-engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The decision log is APPEND-ONLY: this file has GET and POST. There is no
// PATCH here and no DELETE anywhere — corrections are new entries referencing
// the old via correctsId. The one sanctioned amendment (outcomeReview) lives in
// its own write-once route.

const postSchema = z.object({
  symbol: z.string().min(1).transform((s) => s.toUpperCase().trim()),
  action: z.enum(["buy", "add", "trim", "sell_all", "hold_through_trigger", "rebuy", "park_cash"]),
  rationale: z.string().min(20, "Write the actual reasoning — 20 characters is the floor."),
  falsifier: z.string().min(10, "What would prove this decision wrong? Be falsifiable."),
  expectedOutcome: z.string().default(""),
  reviewDate: z.string().default(""),
  firedTriggers: z.array(z.string()).default([]), // client hint; merged with server-evaluated
  weightAfterPct: z.number().min(0).max(100).optional(),
  correctsId: z.string().default(""),
  acknowledgeGuards: z.boolean().default(false),
});

export async function GET(req: NextRequest) {
  await connectDb();
  const symbol = req.nextUrl.searchParams.get("symbol");
  const action = req.nextUrl.searchParams.get("action");
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 100), 500);
  const filter: Record<string, unknown> = { userId: await uid() };
  if (symbol) filter.symbol = symbol.toUpperCase();
  if (action) filter.action = action;
  const docs = await DecisionModel.find(filter).sort({ timestamp: -1 }).limit(limit).lean();
  return NextResponse.json({ decisions: docs });
}

export async function POST(req: NextRequest) {
  try {
    const parsed = postSchema.parse(await req.json());
    await connectDb();

    // Server-side snapshot — the log records what the world looked like, not
    // what the client claims it looked like.
    const snap = await snapshotForDecision(parsed.symbol);

    // Behavioural guard: anchoring to cost. Never blocks — it makes you look
    // once, then you may proceed with acknowledgeGuards.
    const warnings: string[] = [];
    const anchor = detectCostAnchoring(parsed.rationale, snap.avgCost);
    if (anchor) warnings.push(anchor);
    if (warnings.length > 0 && !parsed.acknowledgeGuards) {
      return NextResponse.json({ error: "guard_warnings", warnings }, { status: 409 });
    }

    const doc = await DecisionModel.create({
      userId: await uid(),
      timestamp: new Date().toISOString(),
      symbol: parsed.symbol,
      action: parsed.action,
      priceAtDecision: snap.price,
      weightBeforePct: snap.weightPct,
      weightAfterPct: parsed.weightAfterPct ?? snap.weightPct,
      fairValueSnapshot: snap.fv,
      firedTriggers: [...new Set([...snap.firedTriggers, ...parsed.firedTriggers])],
      rationale: parsed.rationale,
      thesisSnapshot: snap.thesis,
      expectedOutcome: parsed.expectedOutcome,
      falsifier: parsed.falsifier,
      reviewDate: parsed.reviewDate,
      correctsId: parsed.correctsId,
    });
    return NextResponse.json(doc.toObject(), { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}
