import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { uid } from "@/lib/auth/uid";
import { getRuleSettings, saveRuleSettings } from "@/lib/rules/data";

export const dynamic = "force-dynamic";

// The price rules: the steps, the limits past which the economy has changed
// a lot, on or off, and the shares they leave alone ({symbol, off}).
const step = z.object({ move: z.number().min(-99).max(1000), action: z.enum(["hold", "add", "sell"]), sizePct: z.number().min(0).max(100) });
const schema = z.object({
  on: z.boolean().optional(),
  steps: z.array(step).min(1).max(20).optional(),
  ratePts: z.number().min(0.25).max(20).optional(),
  rupeePct: z.number().min(1).max(100).optional(),
  symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9.&-]{1,12}$/).optional(),
  off: z.boolean().optional(),
});

export async function GET() {
  return NextResponse.json(await getRuleSettings());
}

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid" }, { status: 400 });
  const p = parsed.data;
  const me = await uid();
  if (p.symbol != null && p.off != null) {
    const cur = await getRuleSettings(me);
    const off = p.off ? [...cur.off, p.symbol] : cur.off.filter((s) => s !== p.symbol);
    await saveRuleSettings(me, { off });
    return NextResponse.json({ ok: true });
  }
  await saveRuleSettings(me, { on: p.on, steps: p.steps, ratePts: p.ratePts, rupeePct: p.rupeePct });
  return NextResponse.json({ ok: true });
}
