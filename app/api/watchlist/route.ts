import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { uid } from "@/lib/auth/uid";
import { connectDb } from "@/lib/db";
import { WatchlistModel } from "@/lib/models";
import { listings } from "@/lib/watchlist";

export const dynamic = "force-dynamic";

// The watchlist page saves every tick as it is made: one share or one sector
// on or off at a time, so two quick clicks can never overwrite each other.

const toggleSchema = z.object({
  kind: z.enum(["symbol", "sector"]),
  value: z.string().min(1).max(80),
  on: z.boolean(),
});

async function current(userId: string) {
  const doc: any = await WatchlistModel.findOne({ userId }).lean();
  return { symbols: doc?.symbols ?? [], sectors: doc?.sectors ?? [] };
}

export async function GET() {
  await connectDb();
  return NextResponse.json(await current(await uid()));
}

export async function POST(req: NextRequest) {
  const parsed = toggleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  const { kind, value, on } = parsed.data;
  const all = listings();
  const known = kind === "symbol" ? all.some((l) => l.symbol === value) : all.some((l) => l.sector === value);
  if (!known) return NextResponse.json({ error: `unknown ${kind}` }, { status: 400 });
  await connectDb();
  const userId = await uid();
  const field = kind === "symbol" ? "symbols" : "sectors";
  await WatchlistModel.updateOne({ userId }, on ? { $addToSet: { [field]: value } } : { $pull: { [field]: value } }, { upsert: true });
  return NextResponse.json(await current(userId));
}
