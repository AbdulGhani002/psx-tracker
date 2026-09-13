import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { uid } from "@/lib/auth/uid";
import { connectDb } from "@/lib/db";
import { ZakatPaymentModel } from "@/lib/models";

export const dynamic = "force-dynamic";

const postSchema = z.object({
  date: z.string().optional(),
  amount: z.number().positive(),
  notes: z.string().default(""),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = postSchema.parse(body);
    await connectDb();
    const { selectedPortfolio, defaultPortfolio } = await import("@/lib/portfolios");
    const portfolioId = (await selectedPortfolio())?._id || (await defaultPortfolio())?._id || "";
    const created = await ZakatPaymentModel.create({ userId: await uid(), portfolioId, date: parsed.date ? new Date(parsed.date) : new Date(), amount: parsed.amount, notes: parsed.notes });
    return NextResponse.json(created.toObject(), { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}
