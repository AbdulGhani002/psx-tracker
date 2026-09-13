import { NextRequest, NextResponse } from "next/server";
import { uid } from "@/lib/auth/uid";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { HoldingModel, TransactionModel } from "@/lib/models";
import { getCompanyInfo } from "@/lib/prices";
import { deriveFromTransactions } from "@/lib/calculations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const itemSchema = z.object({
  symbol: z.string().min(1).transform((s) => s.toUpperCase().trim()),
  warrantNo: z.string().min(1),
  companyName: z.string().nullable().optional(),
  shares: z.number().positive(),
  ratePerSecurity: z.number().nonnegative(),
  grossAmount: z.number().nonnegative(),
  taxDeducted: z.number().nonnegative().default(0),
  zakatDeducted: z.number().nonnegative().default(0),
  amountPaid: z.number().nonnegative(),
  paymentDate: z.string(),
  financialYear: z.string().nullable().optional(),
  dividendType: z.string().nullable().optional(),
});

const bodySchema = z.object({ items: z.array(itemSchema) });

async function recompute(symbol: string) {
  const txs = await TransactionModel.find({ userId: await uid(), symbol, deletedAt: null }).sort({ date: 1, createdAt: 1 }).lean();
  const derived = deriveFromTransactions(txs as any);
  await HoldingModel.findOneAndUpdate(
    { userId: await uid(), symbol },
    {
      currentShares: derived.shares,
      avgCostBasis: derived.avgCost,
      totalCost: derived.totalCost,
      realizedPL: derived.realizedPL,
      totalDividendsReceived: derived.dividendsReceived,
    }
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { items } = bodySchema.parse(body);
    await connectDb();

    const imported: Array<{ warrantNo: string; symbol: string; id: string }> = [];
    const duplicates: Array<{ warrantNo: string; symbol: string; existingId: string }> = [];
    const errors: Array<{ warrantNo: string; error: string }> = [];

    for (const it of items) {
      try {
        // Dedup by warrant number — index is sparse-unique on the schema.
        const existing = await TransactionModel.findOne({ userId: await uid(), warrantNo: it.warrantNo }).lean();
        if (existing) {
          duplicates.push({
            warrantNo: it.warrantNo,
            symbol: it.symbol,
            existingId: String(existing._id),
          });
          continue;
        }

        // Auto-create Holding if missing, scraping PSX for real metadata.
        let holding = await HoldingModel.findOne({ userId: await uid(), symbol: it.symbol });
        if (!holding) {
          const info = await getCompanyInfo(it.symbol);
          holding = await HoldingModel.create({
      userId: await uid(),
            symbol: it.symbol,
            name: info?.name ?? it.companyName ?? it.symbol,
            sector: info?.sector ?? "Unknown",
            shariaCompliant: false,
          });
        }

        const fees = it.taxDeducted + it.zakatDeducted;
        // The corporate-actions job may have written this dividend already
        // from the announcement; the warrant's exact figures take its place.
        const paid = new Date(it.paymentDate);
        const autoRow = await TransactionModel.findOne({
          userId: await uid(),
          symbol: it.symbol,
          type: "DIVIDEND",
          source: "auto",
          deletedAt: null,
          pricePerShare: { $gte: it.ratePerSecurity - 0.011, $lte: it.ratePerSecurity + 0.011 },
          date: { $gte: new Date(paid.getTime() - 90 * 86400000), $lte: new Date(paid.getTime() + 10 * 86400000) },
        });
        if (autoRow) {
          autoRow.set({
            date: paid,
            shares: it.shares,
            pricePerShare: it.ratePerSecurity,
            totalAmount: it.grossAmount,
            fees,
            netAmount: it.amountPaid,
            notes: (it.dividendType ? `${it.dividendType} dividend` : "Dividend") + (it.financialYear ? ` FY${it.financialYear}` : "") + ` (warrant ${it.warrantNo}, replaced the automatic record)`,
            warrantNo: it.warrantNo,
            taxDeducted: it.taxDeducted,
            zakatDeducted: it.zakatDeducted,
            financialYear: it.financialYear ?? autoRow.financialYear,
            dividendType: it.dividendType ?? autoRow.dividendType,
            source: "warrant",
          });
          await autoRow.save();
          await recompute(it.symbol);
          imported.push({ warrantNo: it.warrantNo, symbol: it.symbol, id: String(autoRow._id) });
          continue;
        }
        const created = await TransactionModel.create({
      userId: await uid(),
          symbol: it.symbol,
          type: "DIVIDEND",
          date: new Date(it.paymentDate),
          shares: it.shares,
          pricePerShare: it.ratePerSecurity,
          totalAmount: it.grossAmount,
          fees,
          netAmount: it.amountPaid,
          notes:
            (it.dividendType ? `${it.dividendType} dividend` : "Dividend") +
            (it.financialYear ? ` FY${it.financialYear}` : "") +
            ` (warrant ${it.warrantNo})`,
          warrantNo: it.warrantNo,
          taxDeducted: it.taxDeducted,
          zakatDeducted: it.zakatDeducted,
          financialYear: it.financialYear ?? "",
          dividendType: it.dividendType ?? "",
          source: "warrant",
        });

        await recompute(it.symbol);
        imported.push({ warrantNo: it.warrantNo, symbol: it.symbol, id: String(created._id) });
      } catch (err: any) {
        // Mongo duplicate-key edge race
        if (err?.code === 11000) {
          duplicates.push({ warrantNo: it.warrantNo, symbol: it.symbol, existingId: "" });
        } else {
          errors.push({ warrantNo: it.warrantNo, error: String(err) });
        }
      }
    }

    return NextResponse.json({
      imported,
      duplicates,
      errors,
      summary: {
        importedCount: imported.length,
        duplicateCount: duplicates.length,
        errorCount: errors.length,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}
