import { AddTradeForm } from "./AddTradeForm";
import { getPortfolioSummary, getMutualFundsValued, getAppSettings } from "@/lib/data";
import { listPortfolios, selectedPortfolio } from "@/lib/portfolios";

export const dynamic = "force-dynamic";

type Props = { searchParams: { symbol?: string; type?: string; shares?: string; date?: string; asset?: string } };

export default async function NewTransactionPage({ searchParams }: Props) {
  const [summary, funds, portfolios, selected, settings] = await Promise.all([getPortfolioSummary(), getMutualFundsValued().catch(() => []), listPortfolios().catch(() => []), selectedPortfolio().catch(() => null), getAppSettings().catch(() => ({}) as any)]);
  const defaultPortfolioId = selected?._id ?? portfolios.find((p) => p.isDefault)?._id ?? "";
  const held = summary.positions.filter((p) => p.shares > 0).map((p) => ({ symbol: p.symbol, name: p.name ?? "", sector: p.sector ?? "", shares: p.shares, price: p.priceKnown ? p.currentPrice : null }));
  const shares = Number(searchParams.shares);
  return (
    <div>
      <div className="mb-3">
        <div className="text-[18px] font-semibold leading-tight">Add trade</div>
        <div className="text-[12px] text-muted mt-0.5">A stock or a mutual fund. Buys, sells, dividends, bonuses, rights and splits flow into cost and P&amp;L.</div>
      </div>
      <AddTradeForm
        held={held}
        funds={funds.map((f: any) => ({ _id: String(f._id), name: f.name, mufapName: f.mufapName, amc: f.amc ?? "", units: f.units ?? 0, nav: f.effectiveNav || f.nav || 0 }))}
        portfolios={portfolios.map((p) => ({ _id: p._id, name: p.name, isDefault: p.isDefault }))}
        defaultPortfolioId={defaultPortfolioId}
        brokeragePct={Number((settings as any).brokeragePct ?? 0.15)}
        initial={{ asset: searchParams.asset, symbol: searchParams.symbol, type: searchParams.type, shares: Number.isFinite(shares) ? shares : undefined, date: searchParams.date }}
      />
    </div>
  );
}
