import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { assemblePlan, savePlaybook, getPlaybook } from "@/lib/plan";
import { getAutoSignalsCached } from "@/lib/feeds/regime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const rung = z.object({
  level: z.number().positive(),
  pct: z.number().min(0).max(100),
  label: z.string().default(""),
  firedAt: z.string().default(""),
  firedAmount: z.number().min(0).default(0),
});

const cashSource = z.object({
  label: z.string().min(1),
  kind: z.enum(["available", "receivable", "expected"]),
  amount: z.number(),
  currency: z.enum(["PKR", "USD"]).default("PKR"),
  fxRate: z.number().min(0).default(0),
  expectedDate: z.string().default(""),
  note: z.string().default(""),
  settledAt: z.string().default(""),
});

const manual = z.object({
  key: z.enum(["foreign", "politics", "breadth"]),
  score: z.number().min(-2).max(2),
  note: z.string().default(""),
  setAt: z.string().default(""),
});

const patchSchema = z
  .object({
    indexName: z.string().min(1).optional(),
    rungs: z.array(rung).optional(),
    poolAtArming: z.number().min(0).optional(),
    armedAt: z.string().optional(),
    ladderReservePct: z.number().min(0).max(100).optional(),
    cashSources: z.array(cashSource).optional(),
    regimeManual: z.array(manual).optional(),
    weeklyReportEnabled: z.boolean().optional(),
    weeklyReportEmail: z.string().email().or(z.literal("")).optional(),
    journalEntry: z
      .object({
        month: z.string(),
        band: z.string().default(""),
        rawScore: z.number().default(0),
        note: z.string().default(""),
        didWhat: z.string().default(""),
        shouldHave: z.string().default(""),
      })
      .optional(),
  })
  .strict();

export async function GET(req: NextRequest) {
  await connectDb();
  // ?refresh=1 forces the market signals to be re-fetched rather than served
  // from the six-hour cache — used by the "refresh signals" button.
  if (req.nextUrl.searchParams.get("refresh") === "1") {
    await getAutoSignalsCached(true).catch(() => null);
  }
  const plan = await assemblePlan();
  return NextResponse.json({ plan });
}

export async function POST(req: NextRequest) {
  try {
    await connectDb();
    const body = patchSchema.parse(await req.json());
    const { journalEntry, ...patch } = body;

    // A journal entry appends rather than replaces: the point of the record is
    // that you can read back what you thought at the time.
    if (journalEntry) {
      const pb: any = await getPlaybook();
      const existing = (pb.regimeJournal ?? []).filter((j: any) => j.month !== journalEntry.month);
      (patch as any).regimeJournal = [...existing, journalEntry].sort((a: any, b: any) =>
        String(a.month).localeCompare(String(b.month))
      );
    }

    // Arming stamps the pool, because every rung is a slice of the money that
    // existed at that moment. Re-arming later is a deliberate act.
    if (patch.poolAtArming != null && !patch.armedAt) {
      (patch as any).armedAt = new Date().toISOString().slice(0, 10);
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }
    await savePlaybook(patch);
    const plan = await assemblePlan();
    return NextResponse.json({ plan });
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") : String(e);
    return NextResponse.json({ error: msg.slice(0, 400) }, { status: 400 });
  }
}
