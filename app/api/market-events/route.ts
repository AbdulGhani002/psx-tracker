import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { MarketEventModel } from "@/lib/models";

export const dynamic = "force-dynamic";

// The dated events the evening brief names (lib/models/MarketEvent): the next
// 120 days, one added, one removed.
const add = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().trim().min(2).max(120),
  kind: z.enum(["mpc", "cpi", "results", "expiry", "holiday", "index", "imf", "budget", "world", "other"]).default("other"),
  about: z.boolean().optional(),
});

const pkToday = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

export async function GET() {
  await connectDb();
  const today = pkToday();
  const until = new Date(Date.parse(today + "T00:00:00Z") + 120 * 86400000).toISOString().slice(0, 10);
  const rows = await MarketEventModel.find({ date: { $gte: today, $lte: until } }).sort({ date: 1, title: 1 }).lean();
  return NextResponse.json(rows.map((r: any) => ({ id: String(r._id), date: r.date, title: r.title, kind: r.kind, about: !!r.about })));
}

export async function POST(req: NextRequest) {
  const parsed = add.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid" }, { status: 400 });
  await connectDb();
  const p = parsed.data;
  await MarketEventModel.updateOne({ date: p.date, title: p.title }, { $set: { kind: p.kind, about: p.about ?? false, source: "entered" } }, { upsert: true });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[a-f0-9]{24}$/.test(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  await connectDb();
  await MarketEventModel.deleteOne({ _id: id });
  return NextResponse.json({ ok: true });
}
