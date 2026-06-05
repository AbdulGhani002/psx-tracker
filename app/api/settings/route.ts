import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { AppSettingsModel } from "@/lib/models";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  filerStatus: z.enum(["filer", "non-filer"]).optional(),
  dividendWhtFiler: z.number().min(0).max(100).optional(),
  dividendWhtNonFiler: z.number().min(0).max(100).optional(),
  cgtRateFiler: z.number().min(0).max(100).optional(),
  cgtRateNonFiler: z.number().min(0).max(100).optional(),
  pmexCommissionPerLot: z.number().min(0).optional(),
  pmexCgtPercent: z.number().min(0).max(100).optional(),
  concentrationCap: z.number().min(0).max(100).optional(),
});

export async function GET() {
  await connectDb();
  const doc = await AppSettingsModel.findOneAndUpdate(
    { key: "global" },
    {},
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
  return NextResponse.json(doc);
}

export async function PATCH(req: NextRequest) {
  try {
    const parsed = patchSchema.parse(await req.json());
    await connectDb();
    const doc = await AppSettingsModel.findOneAndUpdate({ key: "global" }, parsed, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }).lean();
    return NextResponse.json(doc);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}
