import { NextRequest, NextResponse } from "next/server";
import { uid } from "@/lib/auth/uid";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { FixedIncomeModel } from "@/lib/models";
import { tbillCost, depositFace } from "@/lib/fixed-income/value";

export const dynamic = "force-dynamic";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// A T-bill, a sukuk or a fixed deposit. The price can be given as what was
// paid (cost) or, for a T-bill, as the yield it was bought at; the maturity as
// a date or a tenor. A deposit is given by its principal (cost), its profit
// rate (couponPct) and how often it pays (couponsPerYear, 0 at maturity); its
// face is worked out here.
const postSchema = z
  .object({
    kind: z.enum(["tbill", "sukuk", "fd"]),
    name: z.string().trim().min(1),
    face: z.number().positive().optional(),
    cost: z.number().positive().optional(),
    yieldPct: z.number().positive().max(100).optional(),
    purchaseDate: date,
    maturityDate: date.optional(),
    tenorMonths: z.number().int().min(1).max(360).optional(),
    couponPct: z.number().min(0).max(100).default(0),
    couponsPerYear: z.number().int().min(0).max(12).default(0),
    taxPct: z.number().min(0).max(100).default(15),
    pricePct: z.number().positive().max(300).nullable().optional(),
    notes: z.string().default(""),
    portfolioId: z.string().optional(),
  })
  .refine((v) => v.cost != null || (v.kind === "tbill" && v.yieldPct != null), { message: "give what was paid, or for a T-bill its yield" })
  .refine((v) => v.kind === "fd" || v.face != null, { message: "give the face value" })
  .refine((v) => v.kind !== "fd" || v.couponPct > 0, { message: "give the deposit's profit rate" })
  .refine((v) => v.maturityDate != null || v.tenorMonths != null, { message: "give the maturity date or the tenor" });

function addMonths(iso: string, months: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export async function GET() {
  await connectDb();
  const docs = await FixedIncomeModel.find({ userId: await uid() }).sort({ maturityDate: 1 }).lean();
  return NextResponse.json({ holdings: docs });
}

export async function POST(req: NextRequest) {
  try {
    const p = postSchema.parse(await req.json());
    const maturityDate = p.maturityDate ?? addMonths(p.purchaseDate, p.tenorMonths!);
    if (maturityDate <= p.purchaseDate) return NextResponse.json({ error: "invalid", detail: "the maturity must come after the purchase" }, { status: 400 });
    const days = Math.round((Date.parse(maturityDate) - Date.parse(p.purchaseDate)) / 86400000);
    const face = p.kind === "fd" ? depositFace(p.cost!, p.couponPct, p.purchaseDate, maturityDate, p.couponsPerYear) : p.face!;
    const cost = p.cost ?? Math.round(tbillCost(face, p.yieldPct!, days) * 100) / 100;
    await connectDb();
    const { selectedPortfolio, defaultPortfolio } = await import("@/lib/portfolios");
    const portfolioId = p.portfolioId || (await selectedPortfolio())?._id || (await defaultPortfolio())?._id || "";
    const created = await FixedIncomeModel.create({
      userId: await uid(),
      portfolioId,
      kind: p.kind,
      name: p.name,
      face,
      cost,
      purchaseDate: p.purchaseDate,
      maturityDate,
      couponPct: p.kind === "tbill" ? 0 : p.couponPct,
      couponsPerYear: p.kind === "tbill" ? 0 : p.couponsPerYear,
      taxPct: p.taxPct,
      pricePct: p.pricePct ?? null,
      notes: p.notes,
    });
    return NextResponse.json(created.toObject(), { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}
