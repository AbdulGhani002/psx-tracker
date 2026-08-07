import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { uid } from "@/lib/auth/uid";
import { DecisionModel } from "@/lib/models";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The ONE sanctioned amendment to an append-only log entry: grading it later.
// Write-once — the filter requires outcomeReview to still be null, so a second
// attempt 404s instead of rewriting history. Grades the REASONING, not the
// outcome: a good decision can have a bad outcome and vice versa.
const schema = z.object({
  whatHappened: z.string().min(10),
  decisionQuality: z.number().int().min(1).max(5),
  lesson: z.string().default(""),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsed = schema.parse(await req.json());
    await connectDb();
    const doc = await DecisionModel.findOneAndUpdate(
      { _id: params.id, userId: await uid(), outcomeReview: null },
      {
        outcomeReview: {
          reviewedAt: new Date().toISOString(),
          whatHappened: parsed.whatHappened,
          decisionQuality: parsed.decisionQuality,
          lesson: parsed.lesson,
        },
      },
      { new: true }
    ).lean();
    if (!doc) return NextResponse.json({ error: "not_found_or_already_reviewed" }, { status: 404 });
    return NextResponse.json(doc);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}
