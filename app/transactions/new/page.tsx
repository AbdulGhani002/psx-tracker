import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { NewTransactionForm } from "./NewTransactionForm";
import { getAllHoldings, getAppSettings } from "@/lib/data";
import { listPortfolios, selectedPortfolio } from "@/lib/portfolios";

export const dynamic = "force-dynamic";

type Props = { searchParams: { symbol?: string } };

export default async function NewTransactionPage({ searchParams }: Props) {
  const [holdings, portfolios, selected, settings] = await Promise.all([getAllHoldings(), listPortfolios().catch(() => []), selectedPortfolio().catch(() => null), getAppSettings().catch(() => ({}) as any)]);
  const defaultPortfolioId = selected?._id ?? portfolios.find((p) => p.isDefault)?._id ?? "";
  return (
    <div>
      <PageHeader
        title="Record what happened."
        subtitle="Buys, sells, dividends, bonuses, rights, and splits all flow into your cost basis and P/L."
      />
      <Section title="Details">
        <NewTransactionForm
          existingSymbols={holdings.map((h) => h.symbol)}
          defaultSymbol={searchParams.symbol}
          portfolios={portfolios.map((p) => ({ _id: p._id, name: p.name, color: p.color, isDefault: p.isDefault }))}
          defaultPortfolioId={defaultPortfolioId}
          brokeragePct={Number((settings as any).brokeragePct ?? 0.15)}
        />
      </Section>
    </div>
  );
}
