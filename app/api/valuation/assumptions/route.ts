import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { uid } from "@/lib/auth/uid";
import { connectDb } from "@/lib/db";
import { ValuationAssumptionModel } from "@/lib/models";
import { approveVersion } from "@/lib/valuation/run";
import { METHODS } from "@/lib/valuation/engine";

export const dynamic = "force-dynamic";

// A new version of a share's valuation inputs, from the editor: saved as a
// draft, or approved at once (the one before it superseded, the share valued
// again).
const n = z.number().finite().nullable().optional();
const schema = z.object({
  symbol: z.string().trim().min(1).max(12).transform((s) => s.toUpperCase()),
  type: z.enum(["bank", "insurer", "operating", "opco-investments", "holdco", "shell"]),
  policy: z.enum(["quality", "standard", "holdco", "shell"]),
  governance: z.enum(["green", "amber", "red"]),
  confirm: z.string().max(200).default(""),
  eps: n,
  dps: n,
  bvps: n,
  roe: n,
  g: n,
  valueGrowth: n,
  pe: n,
  peSpread: n,
  premium: n,
  sotp: z
    .object({
      parts: z
        .array(z.object({ label: z.string().max(80).default(""), kind: z.enum(["listed", "unlisted", "operating", "cash"]), symbol: z.string().max(12).optional(), shares: n, value: n, haircut: z.number().min(0).max(1).optional() }))
        .max(40),
      netDebt: z.number().finite().default(0),
      discount: z.number().min(0).max(1).default(0),
      shares: z.number().positive(),
    })
    .nullable()
    .optional(),
  weights: z.record(z.enum(METHODS as [string, ...string[]]), z.number().min(0).max(10)).nullable().optional(),
  margins: z.object({ first: z.number().min(0).max(0.95).optional(), second: z.number().min(0).max(0.95).optional(), trim: z.number().min(0.1).max(5).optional() }).nullable().optional(),
  illiquid: z.boolean().default(false),
  metrics: z.record(z.string().max(40), z.number().finite()).nullable().optional(),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(1000).default(""),
  approve: z.boolean().default(true),
});

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  const { approve, ...fields } = parsed.data;
  await connectDb();
  const userId = await uid();
  const last: any = await ValuationAssumptionModel.findOne({ userId, symbol: fields.symbol }).sort({ version: -1 }).lean();
  const doc = await ValuationAssumptionModel.create({ ...fields, userId, version: (last?.version ?? 0) + 1, status: "draft", source: "you" });
  if (approve) await approveVersion(userId, String(doc._id));
  return NextResponse.json({ ok: true, id: String(doc._id), version: doc.version });
}
