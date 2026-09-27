import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { updatePortfolio, deletePortfolio } from "@/lib/portfolios";
import { getCurrentUserId } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().min(1).max(60).optional(),
  broker: z.string().max(60).optional(),
  kind: z.enum(["equity", "funds", "mixed"]).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  notes: z.string().max(500).optional(),
  isDefault: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!(await getCurrentUserId())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const parsed = schema.parse(await req.json());
    const updated = await updatePortfolio(params.id, parsed);
    if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    return NextResponse.json({ error: String((err as any)?.message ?? err) }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!(await getCurrentUserId())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await deletePortfolio(params.id);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
