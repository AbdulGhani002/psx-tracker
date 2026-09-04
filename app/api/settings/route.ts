import { NextRequest, NextResponse } from "next/server";
import { uid } from "@/lib/auth/uid";
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
  mfCashReservePct: z.number().min(0).max(100).optional(),
  strictBuyZones: z.boolean().optional(),
  inflationPct: z.number().min(0).max(100).optional(),
  podWhtFiler: z.number().min(0).max(100).optional(),
  podWhtNonFiler: z.number().min(0).max(100).optional(),
  brokerCashPurpose: z.enum(["", "strategic_wait", "dry_powder", "emergency", "default_dump"]).optional(),
  brokerCashReviewBy: z.string().optional(),
  brokerCashReviewReason: z.string().max(300).optional(),
  equityRiskPremiumPct: z.number().min(0).max(30).optional(),
  defaultFairPE: z.number().min(1).max(40).optional(),
  targetMonthlyIncome: z.number().min(0).optional(),
  telegramBotToken: z.string().optional(),
  telegramChatId: z.string().optional(),
  alertsEnabled: z.boolean().optional(),
});

// Never return the raw bot token to the client. Replace it with a flag.
function sanitize(doc: any) {
  if (!doc) return doc;
  const { telegramBotToken, ...rest } = doc;
  return { ...rest, telegramBotToken: "", telegramConfigured: !!telegramBotToken };
}

export async function GET() {
  await connectDb();
  const u = await uid();
  const doc = await AppSettingsModel.findOneAndUpdate(
    { userId: u },
    { userId: u, key: u },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
  return NextResponse.json(sanitize(doc));
}

export async function PATCH(req: NextRequest) {
  try {
    const parsed = patchSchema.parse(await req.json());
    // Empty token/chat means "leave unchanged" — so saving other settings
    // doesn't wipe the secret the client never received back.
    const update: Record<string, unknown> = { ...parsed };
    if (!update.telegramBotToken) delete update.telegramBotToken;
    if (!update.telegramChatId) delete update.telegramChatId;
    await connectDb();
    const u = await uid();
    const doc = await AppSettingsModel.findOneAndUpdate({ userId: u }, { ...update, userId: u, key: u }, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }).lean();
    return NextResponse.json(sanitize(doc));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}
