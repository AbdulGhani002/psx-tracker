import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { SbpRateModel } from "@/lib/models";
import { SBP_POLICY_RATE_DEFAULTS } from "@/lib/timeseries/sbp-rate";

export const dynamic = "force-dynamic";

const postSchema = z.object({
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  rate: z.number().min(0).max(100),
  note: z.string().default(""),
});

export async function GET() {
  await connectDb();
  const docs = await SbpRateModel.find().sort({ effectiveDate: -1 }).lean();
  return NextResponse.json({ rates: docs, usingDefaults: docs.length === 0 });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Special action: seed the editable table from the built-in defaults.
    if (body?.action === "seed-defaults") {
      await connectDb();
      const count = await SbpRateModel.countDocuments();
      if (count > 0) {
        return NextResponse.json({ error: "already_has_rates" }, { status: 409 });
      }
      await SbpRateModel.insertMany(
        SBP_POLICY_RATE_DEFAULTS.map((s) => ({
          effectiveDate: s.from,
          rate: s.rate,
          note: "Imported default",
        }))
      );
      const docs = await SbpRateModel.find().sort({ effectiveDate: -1 }).lean();
      return NextResponse.json({ rates: docs, seeded: true }, { status: 201 });
    }

    const parsed = postSchema.parse(body);
    await connectDb();
    // Upsert by effectiveDate so re-entering a date updates the rate.
    const doc = await SbpRateModel.findOneAndUpdate(
      { effectiveDate: parsed.effectiveDate },
      { rate: parsed.rate, note: parsed.note },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    return NextResponse.json(doc, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}
