import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { NewTransactionForm } from "./NewTransactionForm";
import { getAllHoldings } from "@/lib/data";

export const dynamic = "force-dynamic";

type Props = { searchParams: { symbol?: string } };

export default async function NewTransactionPage({ searchParams }: Props) {
  const holdings = await getAllHoldings();
  return (
    <div>
      <PageHeader
        eyebrow="New transaction"
        title="Record what happened."
        subtitle="Buys, sells, dividends, bonuses, rights, and splits all flow into your cost basis and P/L."
      />
      <Section title="Details">
        <NewTransactionForm
          existingSymbols={holdings.map((h) => h.symbol)}
          defaultSymbol={searchParams.symbol}
        />
      </Section>
    </div>
  );
}
