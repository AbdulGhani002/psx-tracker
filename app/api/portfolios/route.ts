import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listPortfolios, createPortfolio, selectedPortfolio } from "@/lib/portfolios";
import { getCurrentUserId } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await getCurrentUserId())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [portfolios, selected] = await Promise.all([listPortfolios(), selectedPortfolio()]);
  return NextResponse.json({ portfolios, selected: selected?._id ?? "all" });
}

const schema = z.object({
  name: z.string().min(1).max(60),
  broker: z.string().max(60).optional(),
  kind: z.enum(["equity", "funds", "mixed"]).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  notes: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  if (!(await getCurrentUserId())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const parsed = schema.parse(await req.json());
    const created = await createPortfolio(parsed);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    const msg = String((err as any)?.message ?? err);
    return NextResponse.json({ error: msg.includes("duplicate") ? "a portfolio with that name exists" : msg }, { status: 400 });
  }
}
