import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { Button } from "@/components/ui/Button";
import { TransactionsView } from "./TransactionsView";
import { getAllTransactions, getAllHoldings, checkDataAvailability } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const avail = await checkDataAvailability();
  const [transactions, holdings] = await Promise.all([
    getAllTransactions(),
    getAllHoldings(),
  ]);

  return (
    <div>
      <PageHeader
        eyebrow="Transactions"
        title="Everything that moved."
        subtitle="A complete audit trail of buys, sells, dividends, bonuses, rights, and splits."
      >
        <div className="flex gap-3">
          <Link href="/transactions/new">
            <Button variant="solid">Add Transaction</Button>
          </Link>
        </div>
      </PageHeader>

      {!avail.available && <SetupBanner reason={avail.reason} />}

      <Section number="01" title={`${transactions.length} records`}>
        <TransactionsView transactions={transactions} symbols={holdings.map((h) => h.symbol)} />
      </Section>
    </div>
  );
}
