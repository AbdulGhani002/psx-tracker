import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { EditTransactionForm } from "./EditTransactionForm";
import { connectDb } from "@/lib/db";
import { TransactionModel } from "@/lib/models";
import { checkDataAvailability } from "@/lib/data";
import { getCurrentUserId } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export default async function EditTransactionPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const avail = await checkDataAvailability();
  if (!avail.available) {
    return (
      <div>
        <PageHeader eyebrow="Edit transaction" title="Database unreachable." />
        <SetupBanner reason={avail.reason} />
      </div>
    );
  }

  await connectDb();
  const userId = await getCurrentUserId();
  const doc = userId ? await TransactionModel.findOne({ _id: params.id, userId }).lean() : null;
  if (!doc) notFound();
  const plain = JSON.parse(JSON.stringify(doc));

  return (
    <div>
      <div className="mb-6">
        <Link href={`/holdings/${plain.symbol}`} className="label-cap hover:text-[var(--accent-deep)]">
          ← {plain.symbol}
        </Link>
      </div>
      <PageHeader
        title={`${plain.type} · ${plain.symbol}`}
        subtitle="Editing recomputes the holding's avg cost, total cost, realised P/L and dividends automatically."
      />
      <Section number="01" title="Details" display="Change anything; numbers re-derive on save.">
        <EditTransactionForm
          id={String(plain._id)}
          symbol={plain.symbol}
          initial={{
            type: plain.type,
            date: new Date(plain.date).toISOString().slice(0, 10),
            shares: Math.abs(plain.shares),
            pricePerShare: plain.pricePerShare,
            fees: plain.fees,
            notes: plain.notes,
            ratio: plain.ratio,
            warrantNo: plain.warrantNo ?? "",
            taxDeducted: plain.taxDeducted ?? 0,
            zakatDeducted: plain.zakatDeducted ?? 0,
            financialYear: plain.financialYear ?? "",
            dividendType: plain.dividendType ?? "",
          }}
        />
      </Section>
    </div>
  );
}
