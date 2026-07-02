import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Stat, StatRow } from "@/components/ui/Stat";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CompoundingModelLazy as CompoundingModel } from "@/components/model/CompoundingModelLazy";
import { HoldingSettings } from "./HoldingSettings";
import { HoldingPlaybook } from "./HoldingPlaybook";
import { HoldingTransactions } from "./HoldingTransactions";
import { DividendOverride } from "./DividendOverride";
import { LookThroughPanel } from "./LookThroughPanel";
import { knownHoldingCompany } from "@/lib/holding-companies";
import { FootballField } from "@/components/charts/FootballField";
import { ZoneBar } from "@/components/charts/ZoneBar";
import {
  getHoldingBySymbol,
  getTransactionsBySymbol,
  getCurrentPrices,
  getPortfolioSummary,
  getLookThroughFor,
  getMarketContext,
  getIntrinsicValuations,
} from "@/lib/data";
import { deriveFromTransactions } from "@/lib/calculations";
import {
  fmtRs,
  fmtUsd,
  fmtNum,
  fmtSignedRs,
  fmtSignedPct,
  fmtPct,
} from "@/lib/format";
import { getUsdPkr } from "@/lib/fx";

export const dynamic = "force-dynamic";

type Props = { params: { symbol: string } };

export default async function HoldingDetail({ params }: Props) {
  const symbol = params.symbol.toUpperCase();
  // Fire every independent fetch at once instead of eight serial round-trips.
  const [holding, transactions, lookThrough, market, prices, summary, intrinsicAll, usdPkr] = await Promise.all([
    getHoldingBySymbol(symbol),
    getTransactionsBySymbol(symbol),
    getLookThroughFor(symbol).catch(() => null),
    getMarketContext(symbol).catch(() => null),
    getCurrentPrices([symbol]),
    getPortfolioSummary(),
    getIntrinsicValuations().catch(() => null),
    getUsdPkr(),
  ]);
  if (!holding) notFound();

  const currentPrice = prices.get(symbol) ?? 0;
  const derived = deriveFromTransactions(transactions);
  const currentPercent = summary.positions.find((p) => p.symbol === symbol)?.currentPercent ?? 0;
  const intrinsic = intrinsicAll?.items.find((i) => i.symbol === symbol) ?? null;
  const marketValue = derived.shares * currentPrice;
  const unrealizedPL = marketValue - derived.totalCost;
  const unrealizedPct = derived.totalCost > 0 ? unrealizedPL / derived.totalCost : 0;
  const yieldOnCost = derived.totalCost > 0 ? derived.dividendsReceived / derived.totalCost : 0;
  const h = holding as any;

  return (
    <div>
      <div className="mb-6">
        <Link href="/holdings" className="label-cap hover:text-[var(--accent-deep)]">
          ← Holdings
        </Link>
      </div>
      <PageHeader
        eyebrow={holding.sector}
        title={holding.name && holding.name !== symbol ? holding.name : symbol}
        subtitle={
          holding.name && holding.name !== symbol
            ? `${symbol}${holding.shariaCompliant ? " — Sharia compliant" : ""}`
            : holding.shariaCompliant
            ? "Sharia compliant"
            : undefined
        }
      >
        <div className="flex items-center gap-3 flex-wrap">
          <Link href={`/transactions/new?symbol=${symbol}`}>
            <Button variant="solid">Add Transaction</Button>
          </Link>
          {h.tier && <Badge tone="accent">{h.tier}</Badge>}
          {h.goalTag && <Badge tone="default">{h.goalTag}</Badge>}
          {h.convictionScore > 0 && (
            <span className="label-cap">Conviction {h.convictionScore}/25</span>
          )}
        </div>
      </PageHeader>

      {h.thesis && (
        <p className="text-[15px] leading-relaxed max-w-[68ch] mb-2 -mt-4 text-muted">
          {h.thesis}
        </p>
      )}

      <StatRow>
        <Stat label="Shares Held" value={fmtNum(derived.shares)} />
        <Stat label="Avg Cost" value={fmtRs(derived.avgCost, true)} />
        <Stat label="Current Price" value={fmtRs(currentPrice, true)} />
        <Stat label="Market Value" value={fmtRs(marketValue)} hint={usdPkr ? `≈ ${fmtUsd(marketValue, usdPkr, false)} · ${fmtUsd(derived.totalCost, usdPkr, false)} invested` : undefined} />
        <Stat
          label="Unrealised P/L"
          value={fmtSignedRs(unrealizedPL)}
          hint={fmtSignedPct(unrealizedPct)}
          tone={unrealizedPL >= 0 ? "positive" : "negative"}
        />
        <Stat label="Dividends" value={fmtRs(derived.dividendsReceived)} hint={`Yield on cost ${fmtPct(yieldOnCost, 2)}`} />
      </StatRow>

      {market && (market.week52High != null || market.indices.length > 0) && (
        <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-3 text-[13px]">
          {market.week52High != null && market.week52Low != null && (
            <div className="flex items-center gap-3">
              <span className="label-cap">52-week</span>
              <span className="font-mono mono-num text-muted">{fmtRs(market.week52Low, true)}</span>
              <span className="relative inline-block w-28 h-[4px]" style={{ background: "var(--rule)" }}>
                {market.positionPct != null && (
                  <span className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full" style={{ left: `calc(${Math.min(100, Math.max(0, market.positionPct))}% - 4px)`, background: "var(--accent)" }} aria-hidden />
                )}
              </span>
              <span className="font-mono mono-num text-muted">{fmtRs(market.week52High, true)}</span>
              {market.positionPct != null && <span className="font-mono mono-num text-[11px]" style={{ color: "var(--muted)" }}>{market.positionPct.toFixed(0)}% of range</span>}
            </div>
          )}
          {market.indices.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="label-cap">Indices</span>
              {market.indices.map((ix) => (
                <Badge key={ix} tone="default">{ix}</Badge>
              ))}
            </div>
          )}
        </div>
      )}

      <Section
        number="01"
        title="Transaction history"
        description="Every buy, sell, dividend, bonus, right, and split for this symbol. Use Delete to send a mistaken entry to Trash — you can undo it right away or restore it later."
      >
        <HoldingTransactions transactions={transactions} />
      </Section>

      {intrinsic && intrinsic.intrinsic != null && (
        <Section
          number="02"
          title="Intrinsic value & buying zone"
          display={
            intrinsic.zone === "strong buy" || intrinsic.zone === "buy"
              ? "In a buying zone."
              : intrinsic.zone === "expensive"
              ? "Above fair value."
              : "Around fair value."
          }
          description="What this share is worth, blended from up to six independent models, and the price below which it becomes a buy — with the margin of safety scaled to this stock's own volatility."
          action={
            <Link href={`/intrinsic#${symbol}`} className="font-mono text-[11px] uppercase tracking-stat text-muted hover:text-[var(--accent-deep)]">
              Full analysis →
            </Link>
          }
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
            <Stat label="Live price" value={fmtRs(intrinsic.price, true)} />
            <Stat label="Intrinsic value" value={fmtRs(intrinsic.intrinsic, true)} hint={intrinsic.low != null && intrinsic.high != null ? `range ${fmtRs(intrinsic.low, true)}–${fmtRs(intrinsic.high, true)}` : undefined} />
            <Stat
              label="Margin of safety"
              value={intrinsic.marginOfSafetyPct == null ? "—" : `${intrinsic.marginOfSafetyPct >= 0 ? "+" : ""}${intrinsic.marginOfSafetyPct.toFixed(0)}%`}
              tone={intrinsic.marginOfSafetyPct != null && intrinsic.marginOfSafetyPct >= 0 ? "positive" : "negative"}
            />
            <Stat label="Buy below" value={intrinsic.buyBelow == null ? "—" : fmtRs(intrinsic.buyBelow, true)} tone="positive" hint={intrinsic.strongBuyBelow != null ? `strong buy ≤ ${fmtRs(intrinsic.strongBuyBelow, true)}` : undefined} />
          </div>
          <ZoneBar price={intrinsic.price} strongBuyBelow={intrinsic.strongBuyBelow} buyBelow={intrinsic.buyBelow} fairUpTo={intrinsic.fairUpTo} intrinsic={intrinsic.intrinsic} zone={intrinsic.zone} />
          <div className="grid md:grid-cols-2 gap-6 mt-6">
            <div>
              <div className="label-cap mb-2">Valuation methods</div>
              <FootballField methods={intrinsic.methods} price={intrinsic.price} intrinsic={intrinsic.intrinsic} />
            </div>
            <div>
              <div className="label-cap mb-2">Why</div>
              <ul className="space-y-2 text-[13px] text-muted">
                {intrinsic.drivers.map((d, i) => (
                  <li key={i} className="flex gap-2">
                    <span style={{ color: "var(--accent-deep)" }}>—</span>
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Section>
      )}

      <Section
        number="03"
        title="Playbook"
        display="Your thesis, tier, and the numbers to watch."
        description="Encode your sizing framework: which tier this belongs to, your conviction score, the job it does, and the quarterly numbers that tell you the thesis is healing or breaking."
      >
        <HoldingPlaybook
          symbol={symbol}
          currentPercent={currentPercent}
          initial={{
            tier: h.tier ?? "",
            convictionScore: h.convictionScore ?? 0,
            goalTag: h.goalTag ?? "",
            thesis: h.thesis ?? "",
            trackedMetrics: h.trackedMetrics ?? [],
          }}
        />
      </Section>

      <Section
        number="04"
        title="Settings"
        description="Edit target allocation, rebalance band, Sharia status, name/sector overrides, and notes. Refresh from PSX to re-scrape company info."
      >
        <HoldingSettings
          symbol={symbol}
          transactionCount={transactions.length}
          initial={{
            name: holding.name,
            sector: holding.sector,
            shariaCompliant: holding.shariaCompliant,
            targetAllocationPercent: holding.targetAllocationPercent ?? 0,
            rebalanceBand: (holding as any).rebalanceBand ?? 3,
            targetRationale: (holding as any).targetRationale ?? "",
            notes: holding.notes ?? "",
          }}
        />
      </Section>

      <Section
        number="05"
        title="Dividend forecast override"
        display="Pin the dividend numbers."
        description="When the automatic forecast gets a stock wrong — unusual par value, incomplete recorded dividends, or a cadence it can't read — set the values here. Anything left at Auto stays automatic."
      >
        <DividendOverride
          symbol={symbol}
          initial={{
            parValue: h.dividendOverride?.parValue ?? 0,
            cadence: h.dividendOverride?.cadence ?? "",
            payoutRatioPct: h.dividendOverride?.payoutRatioPct ?? 0,
            expectedAnnualDps: h.dividendOverride?.expectedAnnualDps ?? 0,
          }}
          bookValuePerShare={h.bookValuePerShare ?? 0}
        />
      </Section>

      <Section
        number="06"
        title="Look-through value"
        display="What it really owns."
        description="For a holding company, sum the live value of the stakes it owns (and subtract its debt) to get a net asset value per share, then compare to the market price. The gap is the holding-company discount."
      >
        <LookThroughPanel
          symbol={symbol}
          initial={{
            enabled: h.lookThrough?.enabled ?? false,
            constituents: h.lookThrough?.constituents ?? [],
            unlistedHoldings: h.lookThrough?.unlistedHoldings ?? [],
            unlistedValuePkr: h.lookThrough?.unlistedValuePkr ?? 0,
            netDebtPkr: h.lookThrough?.netDebtPkr ?? 0,
            sharesOutstanding: h.lookThrough?.sharesOutstanding ?? 0,
          }}
          result={lookThrough}
          known={knownHoldingCompany(symbol)}
        />
      </Section>

      <Section
        number="07"
        title="Forward projection"
        description="A multi-scenario compounding model specific to this stock. Pick a preset, tune the sliders, then save them as this stock's defaults."
      >
        <CompoundingModel
          initialShares={derived.shares}
          currentPrice={currentPrice}
          symbol={symbol}
          totalCost={derived.totalCost}
          savedAssumptions={h.modelAssumptions?.saved ? h.modelAssumptions : undefined}
          allowSave
        />
      </Section>
    </div>
  );
}
