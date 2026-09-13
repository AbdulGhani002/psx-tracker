import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Button } from "@/components/ui/Button";
import { TrashView } from "./TrashView";
import { getDeletedTransactions, checkDataAvailability } from "@/lib/data";
import { SetupBanner } from "@/components/layout/SetupBanner";

export const dynamic = "force-dynamic";

export default async function TrashPage() {
  const avail = await checkDataAvailability();
  const deleted = await getDeletedTransactions();

  return (
    <div>
      <PageHeader
        title="Recently deleted."
        subtitle="Soft-deleted transactions are kept here. They do not affect any holding, dividend, tax, or cash figure. Restore one to bring it back, or delete it forever."
      >
        <Link href="/transactions">
          <Button variant="outline">Back to Transactions</Button>
        </Link>
      </PageHeader>

      {!avail.available && <SetupBanner reason={avail.reason} />}

      <Section number="01" title={`${deleted.length} in Trash`}>
        <TrashView transactions={deleted} />
      </Section>
    </div>
  );
}
