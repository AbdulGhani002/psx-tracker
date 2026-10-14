import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { uid } from "@/lib/auth/uid";
import { connectDb } from "@/lib/db";
import { SellListModel } from "@/lib/models";
import { listings } from "@/lib/listings";
import { pktToday } from "@/lib/quant/sheet-bars";
import { cleanLevels } from "@/lib/sell-list/levels";

export const dynamic = "force-dynamic";

// A share on the sell list with its levels. Saving a share already on the
// list replaces its levels, and every level counts again from today.
const level = z.object({ price: z.number().positive(), kind: z.enum(["profit", "stop"]), sellPct: z.number().positive().max(100).nullable().optional(), note: z.string().max(120).optional() });
const schema = z.object({
  symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9.&-]{1,12}$/),
  levels: z.array(level).min(1).max(6),
  note: z.string().max(200).default(""),
});

export async function GET() {
  await connectDb();
  const docs = await SellListModel.find({ userId: await uid() }).sort({ symbol: 1 }).lean();
  return NextResponse.json({ items: docs });
}

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid" }, { status: 400 });
  const { symbol, note } = parsed.data;
  if (!listings().some((l) => l.symbol === symbol)) return NextResponse.json({ error: `${symbol} is not a listed share` }, { status: 400 });
  const levels = cleanLevels(parsed.data.levels, pktToday());
  if (levels.length === 0) return NextResponse.json({ error: "give at least one price" }, { status: 400 });
  await connectDb();
  const doc = await SellListModel.findOneAndUpdate({ userId: await uid(), symbol }, { $set: { levels, note, checkedThrough: "" } }, { upsert: true, new: true }).lean();
  return NextResponse.json({ ok: true, item: doc });
}
