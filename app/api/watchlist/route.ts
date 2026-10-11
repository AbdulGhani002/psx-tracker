import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { uid } from "@/lib/auth/uid";
import { connectDb } from "@/lib/db";
import { WatchlistModel } from "@/lib/models";
import { listings } from "@/lib/watchlist";
import { readNewlyWatched } from "@/lib/fundamentals/refresh";

export const dynamic = "force-dynamic";

// The watchlist page's Save button: the ticked sectors, all at once, replacing
// what was kept, and the company pages of their shares never read before
// read in the background (`reading` says how many). GET reads them back, so
// the page always opens on what the database holds.

const saveSchema = z.object({ sectors: z.array(z.string().min(1).max(80)).max(200) });

async function current(userId: string) {
  const doc: any = await WatchlistModel.findOne({ userId }).lean();
  return { sectors: (doc?.sectors ?? []) as string[], savedAt: doc?.updatedAt ? new Date(doc.updatedAt).toISOString() : null };
}

export async function GET() {
  await connectDb();
  return NextResponse.json(await current(await uid()), { headers: { "cache-control": "no-store" } });
}

export async function PUT(req: NextRequest) {
  const parsed = saveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  const known = new Set(listings().map((l) => l.sector));
  const unknown = parsed.data.sectors.filter((s) => !known.has(s));
  if (unknown.length) return NextResponse.json({ error: `unknown sector ${unknown[0]}` }, { status: 400 });
  await connectDb();
  const userId = await uid();
  await WatchlistModel.updateOne({ userId }, { $set: { sectors: [...new Set(parsed.data.sectors)], symbols: [] } }, { upsert: true });
  const reading = await readNewlyWatched().catch(() => 0);
  return NextResponse.json({ ...(await current(userId)), reading }, { headers: { "cache-control": "no-store" } });
}
