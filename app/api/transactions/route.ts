import { NextRequest, NextResponse } from "next/server";
import { DecisionModel } from "@/lib/models";
import { detectCostAnchoring } from "@/lib/calculations/sell-engine";
import { getSellDiscipline } from "@/lib/data-decisions";
import { getPortfolioSummary } from "@/lib/data";
import { uid } from "@/lib/auth/uid";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { HoldingModel, TransactionModel, TRANSACTION_TYPES } from "@/lib/models";
import { getCompanyInfo } from "@/lib/prices";
import { deriveFromTransactions } from "@/lib/calculations";
import { selectedPortfolio, defaultPortfolio } from "@/lib/portfolios";

// The portfolio a new row belongs to: what the form said, else the one the
// pages are looking at, else the default.
async function portfolioFor(requested?: string | null): Promise<string> {
  if (requested) return requested;
  const sel = await selectedPortfolio();
  if (sel) return sel._id;
  const def = await defaultPortfolio();
  return def?._id ?? "";
}

export const dynamic = "force-dynamic";

const txSchema = z.object({
  symbol: z.string().min(1).transform((s) => s.toUpperCase().trim()),
  type: z.enum(TRANSACTION_TYPES),
  date: z.string().or(z.date()),
  shares: z.number().default(0),
  pricePerShare: z.number().default(0),
  fees: z.number().default(0),
  notes: z.string().default(""),
  ratio: z.string().default(""),
  portfolioId: z.string().optional(),
  // SELLING REQUIRES A DECISION. Recording a SELL without rationale + falsifier
  // is impossible by design — holding needs no courage; selling needs a log.
  decision: z
    .object({
      rationale: z.string().min(20, "Write the actual reasoning (min 20 chars)."),
      falsifier: z.string().min(10, "What would prove this decision wrong?"),
      expectedOutcome: z.string().default(""),
      reviewDate: z.string().default(""),
      acknowledgeGuards: z.boolean().default(false),
      rebuy: z
        .object({
          maxPrice: z.number().min(0).default(0),
          requiredConditions: z.array(z.string()).default([]),
          reviewOn: z.string().default(""),
        })
        .optional(),
    })
    .optional(),
  // OPENING a brand-new position requires a plan: a classification, a price
  // ceiling, and at least one falsifiable invalidator — written before emotion.
  plan: z
    .object({
      classification: z.enum(["compounder", "stalwart", "cyclical", "asset_play", "turnaround", "value_trap"]),
      fvHigh: z.number().positive("Set your price ceiling — the pre-committed sell line."),
      invalidator: z.string().min(10, "One falsifiable invalidator, phrased so a number or event can confirm it."),
    })
    .optional(),
}).refine(
  (v) => v.type !== "SPLIT" || /^\d+\s*:\s*\d+$/.test(v.ratio.trim()),
  { message: "SPLIT requires a ratio like '1:2' (old:new).", path: ["ratio"] }
);

async function recomputeHolding(symbol: string) {
  const txs = await TransactionModel.find({ userId: await uid(), symbol, deletedAt: null }).sort({ date: 1, createdAt: 1 }).lean();
  const derived = deriveFromTransactions(txs as any);
  await HoldingModel.findOneAndUpdate(
    { userId: await uid(), symbol },
    {
      currentShares: derived.shares,
      avgCostBasis: derived.avgCost,
      totalCost: derived.totalCost,
      realizedPL: derived.realizedPL,
      totalDividendsReceived: derived.dividendsReceived,
    }
  );
}

export async function GET(req: NextRequest) {
  await connectDb();
  const symbol = req.nextUrl.searchParams.get("symbol");
  const type = req.nextUrl.searchParams.get("type");
  const filter: Record<string, unknown> = { deletedAt: null };
  if (symbol) filter.symbol = symbol.toUpperCase();
  if (type) filter.type = type;
  const docs = await TransactionModel.find({ ...filter, userId: await uid() }).sort({ date: -1, createdAt: -1 }).lean();
  return NextResponse.json({ transactions: docs });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = txSchema.parse(body);
    await connectDb();

    let holding = await HoldingModel.findOne({ userId: await uid(), symbol: parsed.symbol });

    // Guard: can't sell more than you hold (would create negative shares).
    let heldBefore = 0;
    let avgCostBefore = 0;
    if (parsed.type === "SELL") {
      const existing = await TransactionModel.find({ userId: await uid(), symbol: parsed.symbol, deletedAt: null }).lean();
      const derivedBefore = deriveFromTransactions(existing as any);
      heldBefore = derivedBefore.shares;
      avgCostBefore = derivedBefore.avgCost;
      if (Math.abs(parsed.shares) > heldBefore + 1e-6) {
        return NextResponse.json(
          { error: "oversell", detail: `You hold ${heldBefore} ${parsed.symbol} shares; cannot sell ${Math.abs(parsed.shares)}.` },
          { status: 400 }
        );
      }

      // A decision may be logged with a sale; it is no longer required. When
      // one is given, the cost-anchoring guard still asks for a second look.
      if (parsed.decision) {
        const anchor = detectCostAnchoring(parsed.decision.rationale, avgCostBefore);
        if (anchor && !parsed.decision.acknowledgeGuards) {
          return NextResponse.json({ error: "guard_warnings", warnings: [anchor] }, { status: 409 });
        }
      }
    }

    const isNewPosition = parsed.type === "BUY" && (!holding || (holding.currentShares ?? 0) <= 0);
    if (!holding) {
      // Brand new symbol — look it up on PSX so we don't store garbage metadata.
      const info = await getCompanyInfo(parsed.symbol);
      holding = await HoldingModel.create({
      userId: await uid(),
        symbol: parsed.symbol,
        name: info?.name ?? parsed.symbol,
        sector: info?.sector ?? "Unknown",
        shariaCompliant: false,
      });
    }

    let signedShares = parsed.shares;
    if (parsed.type === "SELL" && signedShares > 0) signedShares = -Math.abs(signedShares);

    const totalAmount = Math.abs(signedShares) * parsed.pricePerShare;
    let netAmount = totalAmount;
    if (parsed.type === "BUY" || parsed.type === "RIGHT") {
      netAmount = totalAmount + parsed.fees;
    } else if (parsed.type === "SELL") {
      netAmount = totalAmount - parsed.fees;
    } else if (parsed.type === "DIVIDEND") {
      netAmount = Math.abs(signedShares) * parsed.pricePerShare - parsed.fees;
    } else {
      netAmount = 0;
    }

    // A dividend or bonus the corporate-actions job already wrote from the
    // announcement is replaced by what the user types, not doubled.
    if (parsed.type === "DIVIDEND" || parsed.type === "BONUS") {
      const when = new Date(parsed.date);
      const autoRow = await TransactionModel.findOne({
        userId: await uid(),
        symbol: parsed.symbol,
        type: parsed.type,
        source: "auto",
        deletedAt: null,
        ...(parsed.type === "DIVIDEND" ? { pricePerShare: { $gte: parsed.pricePerShare - 0.011, $lte: parsed.pricePerShare + 0.011 } } : {}),
        date: { $gte: new Date(when.getTime() - 90 * 86400000), $lte: new Date(when.getTime() + 15 * 86400000) },
      });
      if (autoRow) {
        autoRow.set({ date: when, shares: Math.abs(signedShares), pricePerShare: parsed.pricePerShare, totalAmount, fees: parsed.fees, netAmount, notes: parsed.notes || `${autoRow.notes} (figures typed in)`, source: "" });
        await autoRow.save();
        await recomputeHolding(parsed.symbol);
        return NextResponse.json({ ...autoRow.toObject(), replacedAuto: true }, { status: 201 });
      }
    }

    const created = await TransactionModel.create({
      userId: await uid(),
      portfolioId: await portfolioFor(parsed.portfolioId),
      symbol: parsed.symbol,
      type: parsed.type,
      date: new Date(parsed.date),
      shares: parsed.type === "SELL" ? signedShares : Math.abs(signedShares),
      pricePerShare: parsed.pricePerShare,
      totalAmount,
      fees: parsed.fees,
      netAmount,
      notes: parsed.notes,
      ratio: parsed.ratio,
    });

    // Persist the opening plan on a new position.
    if (isNewPosition && parsed.plan) {
      const today = new Date().toISOString().slice(0, 10);
      await HoldingModel.updateOne(
        { userId: await uid(), symbol: parsed.symbol },
        {
          $set: {
            "plan.classification": parsed.plan.classification,
            "plan.fvHigh": parsed.plan.fvHigh,
            "plan.fvUpdatedAt": today,
            "plan.openedAt": today,
          },
          $push: { "plan.invalidators": { text: parsed.plan.invalidator, occurredAt: "" } },
        }
      );
    }

    // Write the SELL's decision entry — atomically with the trade: if the log
    // write fails, the trade is rolled back. No log, no sale.
    if (parsed.type === "SELL" && parsed.decision) {
      try {
        const sharesAfter = heldBefore - Math.abs(parsed.shares);
        const action = sharesAfter > 1e-6 ? "trim" : "sell_all";
        const summaryBefore = await getPortfolioSummary(); // pre-tx cache = state at decision time
        const totalBefore = summaryBefore.totalValue;
        const soldValue = Math.abs(parsed.shares) * parsed.pricePerShare;
        const weightBeforePct = totalBefore > 0 ? ((heldBefore * parsed.pricePerShare) / totalBefore) * 100 : 0;
        const totalAfter = totalBefore - soldValue;
        const weightAfterPct = totalAfter > 0 ? ((sharesAfter * parsed.pricePerShare) / totalAfter) * 100 : 0;
        const hplan: any = (holding as any)?.plan ?? {};
        let fired: string[] = [];
        try {
          const disc = await getSellDiscipline();
          fired = (disc.positions.find((x) => x.signal.symbol === parsed.symbol)?.firedRaw ?? []).map((t) => t.type);
        } catch { /* triggers unavailable — log proceeds without them */ }

        await DecisionModel.create({
          userId: await uid(),
          timestamp: new Date().toISOString(),
          symbol: parsed.symbol,
          action,
          priceAtDecision: parsed.pricePerShare,
          weightBeforePct,
          weightAfterPct,
          fairValueSnapshot: { low: hplan.fvLow ?? 0, base: hplan.fvBase ?? 0, high: hplan.fvHigh ?? 0, method: hplan.fvMethod ?? "" },
          firedTriggers: fired,
          rationale: parsed.decision.rationale,
          thesisSnapshot: (holding as any)?.thesis ?? "",
          expectedOutcome: parsed.decision.expectedOutcome,
          falsifier: parsed.decision.falsifier,
          reviewDate: parsed.decision.reviewDate,
        });

        // Optional pre-committed re-buy rule on exit: the "do not chase" contract.
        const rb = parsed.decision.rebuy;
        if (rb && (rb.maxPrice > 0 || rb.reviewOn)) {
          await HoldingModel.updateOne(
            { userId: await uid(), symbol: parsed.symbol },
            { $set: { rebuyRule: { active: true, maxPrice: rb.maxPrice, requiredConditions: rb.requiredConditions, reviewOn: rb.reviewOn, setAt: new Date().toISOString().slice(0, 10) } } }
          );
        }
      } catch (e) {
        // Compensate: no log entry -> no sale.
        await TransactionModel.deleteOne({ _id: created._id }).catch(() => {});
        await recomputeHolding(parsed.symbol).catch(() => {});
        return NextResponse.json({ error: "decision_log_failed", detail: String(e).slice(0, 200) }, { status: 500 });
      }
    }

    await recomputeHolding(parsed.symbol);
    return NextResponse.json(created.toObject(), { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}
