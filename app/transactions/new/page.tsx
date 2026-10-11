import { AddTradeForm } from "./AddTradeForm";
import { getPortfolioSummary, getMutualFundsValued, getSavingsValued, getAppSettings } from "@/lib/data";
import { whtPct } from "@/lib/calculations/pk-tax";
import { listPortfolios, selectedPortfolio } from "@/lib/portfolios";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ symbol?: string; type?: string; shares?: string; date?: string; asset?: string; kind?: string }> };

export default async function NewTransactionPage(props: Props) {
  const searchParams = await props.searchParams;
  const [summary, funds, savings, portfolios, selected, settings] = await Promise.all([getPortfolioSummary(), getMutualFundsValued().catch(() => []), getSavingsValued().catch(() => []), listPortfolios().catch(() => []), selectedPortfolio().catch(() => null), getAppSettings().catch(() => (({}) as any))]);
  const defaultPortfolioId = selected?._id ?? portfolios.find((p) => p.isDefault)?._id ?? "";
  const held = [...summary.positions, ...summary.parked].filter((p) => p.shares > 0).map((p) => ({ symbol: p.symbol, name: p.name ?? "", sector: p.sector ?? "", shares: p.shares, price: p.priceKnown ? p.currentPrice : null }));
  const shares = Number(searchParams.shares);
  return (
    <div>
      <div className="mb-3">
        <div className="text-[18px] font-semibold leading-tight">Add trade</div>
        <div className="text-[12px] text-muted mt-0.5">A stock, a mutual fund or cash. Money-market funds, fixed deposits, bank accounts and T-bills all count as cash.</div>
      </div>
      <AddTradeForm
        held={held}
        funds={funds.map((f: any) => ({ _id: String(f._id), name: f.name, mufapName: f.mufapName, amc: f.amc ?? "", units: f.units ?? 0, nav: f.effectiveNav || f.nav || 0, moneyMarket: !!f.moneyMarket }))}
        accounts={savings.map((a: any) => ({ _id: String(a._id), name: a.name, bank: a.bank ?? "", balance: Number(a.balance) || 0, ratePercent: Number(a.ratePercent) || 0 }))}
        taxPct={whtPct("profit-on-debt", settings as any)}
        portfolios={portfolios.map((p) => ({ _id: p._id, name: p.name, isDefault: p.isDefault }))}
        defaultPortfolioId={defaultPortfolioId}
        brokeragePct={Number((settings as any).brokeragePct ?? 0.15)}
        initial={{ asset: searchParams.asset, kind: searchParams.kind, symbol: searchParams.symbol, type: searchParams.type, shares: Number.isFinite(shares) ? shares : undefined, date: searchParams.date }}
      />
    </div>
  );
}
