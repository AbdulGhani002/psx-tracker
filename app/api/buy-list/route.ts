import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { uid } from "@/lib/auth/uid";
import { connectDb } from "@/lib/db";
import { BuyListModel } from "@/lib/models";
import { listings } from "@/lib/listings";
import { pktToday } from "@/lib/quant/sheet-bars";
import { cleanTiers } from "@/lib/buy-list/zones";

export const dynamic = "force-dynamic";

// A share on the buy list with its tiers. Saving a share already on the list
// replaces its tiers, and every tier counts again from today.
const tier = z.object({ high: z.number().positive(), low: z.number().positive().nullable().optional(), note: z.string().max(120).optional() });
const schema = z.object({
  symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9.&-]{1,12}$/),
  tiers: z.array(tier).min(1).max(6),
  note: z.string().max(200).default(""),
});

export async function GET() {
  await connectDb();
  const docs = await BuyListModel.find({ userId: await uid() }).sort({ symbol: 1 }).lean();
  return NextResponse.json({ items: docs });
}

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid" }, { status: 400 });
  const { symbol, note } = parsed.data;
  if (!listings().some((l) => l.symbol === symbol)) return NextResponse.json({ error: `${symbol} is not a listed share` }, { status: 400 });
  const tiers = cleanTiers(parsed.data.tiers, pktToday());
  if (tiers.length === 0) return NextResponse.json({ error: "give at least one price" }, { status: 400 });
  await connectDb();
  const doc = await BuyListModel.findOneAndUpdate({ userId: await uid(), symbol }, { $set: { tiers, note, checkedThrough: "" } }, { upsert: true, new: true }).lean();
  return NextResponse.json({ ok: true, item: doc });
}
