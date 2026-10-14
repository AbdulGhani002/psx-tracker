import Link from "next/link";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { CompanyQualityPanel } from "@/components/quality/CompanyQualityPanel";
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
import { BuyWhatIf } from "./BuyWhatIf";
import { TrimWhatIf } from "./TrimWhatIf";
import { SellPlanPanel } from "./SellPlanPanel";
import { EventRecordCard } from "./EventRecordCard";
import { getEventRecord } from "@/lib/quant/event-record";
import { buildLots } from "@/lib/calculations/lots";
import { currentTaxYear } from "@/lib/dates";
import { getSellDiscipline, getDecisionsFor } from "@/lib/data-decisions";
import { knownHoldingCompany } from "@/lib/holding-companies";
import {
  getHoldingBySymbol,
  getTransactionsBySymbol,
  getCurrentPrices,
  getPortfolioSummary,
  getLookThroughFor,
  getMarketContext,
  getAppSettings,
  getDividendForecast,
} from "@/lib/data";
import { deriveFromTransactions, heldAndSold, moneyAtWork } from "@/lib/calculations";
import {
  fmtRs,
  fmtUsd,
  fmtNum,
  fmtSignedRs,
  fmtSignedPct,
  fmtPct,
  fmtDollars,
  fmtSignedDollars,
} from "@/lib/format";
import { getUsdPkr } from "@/lib/fx";
import { getUsdPkrSeries } from "@/lib/analytics/dashboard";
import { holdingDollars } from "@/lib/analytics/dollarized";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ symbol: string }> };

export default async function HoldingDetail(props: Props) {
  const params = await props.params;
  const symbol = params.symbol.toUpperCase();
  // Fire every independent fetch at once instead of eight serial round-trips.
  const [holding, transactions, lookThrough, market, prices, summary, usdPkr, settings, usdRates] = await Promise.all([
    getHoldingBySymbol(symbol),
    getTransactionsBySymbol(symbol),
    getLookThroughFor(symbol).catch(() => null),
    getMarketContext(symbol).catch(() => null),
    getCurrentPrices([symbol]),
    getPortfolioSummary(),
    getUsdPkr(),
    getAppSettings(),
    getUsdPkrSeries(),
  ]);
  if (!holding) notFound();

  const currentPrice = prices.get(symbol) ?? 0;
  const derived = deriveFromTransactions(transactions);
  const currentPercent = summary.positions.find((p) => p.symbol === symbol)?.currentPercent ?? 0;
  const marketValue = derived.shares * currentPrice;
  const unrealizedPL = marketValue - derived.totalCost;
  const unrealizedPct = derived.totalCost > 0 ? unrealizedPL / derived.totalCost : 0;
  // Dividends follow the shares that earned them (heldAndSold): the shares
  // held are credited only with what they earned, and the shares sold carry
  // their dividends into what the sales booked.
  const split = heldAndSold(transactions);
  const heldTotal = unrealizedPL + split.held.dividends;
  const rupeeTotalPct = derived.totalCost > 0 ? heldTotal / derived.totalCost : null;
  // Dividend yield on cost: a year of the company's dividends a share (its
  // last finished year of payouts, from the dividend forecast) on the
  // average price paid.
  const profile = (await getDividendForecast().catch(() => null))?.profiles.find((p) => p.symbol === symbol) ?? null;
  const yearDps = profile?.declaredAnnualDps ?? 0;
  const divYieldOnCost = derived.avgCost > 0 && derived.shares > 0 && yearDps > 0 ? yearDps / derived.avgCost : null;
  const booked = split.sold.shares > 0 ? split.sold.proceeds - split.sold.cost + split.sold.dividends : null;
  // Yield on cost: everything (every dividend, every trade's booked result,
  // the open position) on the capital employed, averaged over the days held.
  const work = moneyAtWork(transactions);
  const employed = work.average > 0 ? work.average : derived.totalCost;
  const everything = derived.dividendsReceived + derived.realizedPL + unrealizedPL;
  const yoc = employed > 0 ? everything / employed : null;
  const heldFor = work.daysHeld < 45 ? `${work.daysHeld} days` : `${Math.round(work.daysHeld / 30.44)} months`;
  // The same position in dollars: each purchase, sale and dividend at its own
  // day's USD/PKR rate, the shares at today's.
  const hd = derived.shares > 0 && currentPrice > 0 ? holdingDollars(transactions, marketValue, usdRates) : null;
  const h = holding as any;
  // Sell-discipline context: fired triggers, spread, and this symbol's own
  // decision history. Best-effort — a feed being down must not sink the page.
  const [discipline, symbolDecisions, eventRecord] = await Promise.all([
    getSellDiscipline().catch(() => null),
    getDecisionsFor(symbol).catch(() => []),
    getEventRecord(symbol).catch(() => null),
  ]);
  const disc = discipline?.positions.find((x) => x.signal.symbol === symbol) ?? null;

  // Sector peers from the market-wide ratings universe — the opportunity-cost
  // argument with names on it. Best-effort: analytics down → section absent.
  let peers: Array<{ symbol: string; pe: number | null; ey: number | null; dy: number | null }> = [];
  let peerSector = "";
  try {
    const { getRatings } = await import("@/lib/analytics");
    const ratings = await getRatings(500);
    const mine = (ratings?.results ?? []).find((x: any) => x.symbol?.toUpperCase() === symbol);
    if (mine?.sector) {
      peerSector = mine.sector;
      peers = (ratings?.results ?? [])
        .filter((x: any) => x.sector === mine.sector)
        .map((x: any) => ({ symbol: x.symbol.toUpperCase(), pe: x.pe ?? null, ey: x.earnings_yield_pct ?? null, dy: x.dividend_yield_pct ?? null }))
        .sort((a: any, b: any) => (b.ey ?? -1) - (a.ey ?? -1))
        .slice(0, 14);
    }
  } catch {
    /* analytics unavailable */
  }
  const med = (xs: Array<number | null>) => {
    const v = xs.filter((x): x is number => x != null && Number.isFinite(x)).sort((a, b) => a - b);
    if (v.length === 0) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };

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
          {h.parked && <Badge tone="default">Parked · kept for reports, not counted</Badge>}
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
        <Stat label="Market Value" value={fmtRs(marketValue)} hint={hd ? `≈ ${fmtDollars(hd.valueUsd)} at Rs ${hd.rateNow.toFixed(2)} a dollar` : usdPkr ? `≈ ${fmtUsd(marketValue, usdPkr, false)}` : undefined} />
        <Stat
          label="Unrealised P/L"
          value={fmtSignedRs(unrealizedPL)}
          hint={fmtSignedPct(unrealizedPct)}
          tone={unrealizedPL >= 0 ? "positive" : "negative"}
        />
        <Stat
          label="Yield on cost"
          value={fmtSignedPct(yoc)}
          hint={`Dividends ${fmtSignedRs(derived.dividendsReceived)} · trades ${fmtSignedRs(derived.realizedPL)} · open ${fmtSignedRs(unrealizedPL)} = ${fmtSignedRs(everything)}, on ${fmtRs(employed)} employed on average over ${heldFor}`}
          tone={everything >= 0 ? "positive" : "negative"}
        />
        <Stat
          label="Total P/L"
          value={fmtSignedRs(heldTotal)}
          hint={`${fmtSignedPct(rupeeTotalPct)} · open ${fmtSignedRs(unrealizedPL)} + dividends these shares earned ${fmtRs(split.held.dividends)}`}
          tone={heldTotal >= 0 ? "positive" : "negative"}
        />
        {booked != null && (
          <Stat
            label="Booked"
            value={fmtSignedRs(booked)}
            hint={`${fmtNum(split.sold.shares)} sold: sales ${fmtSignedRs(split.sold.proceeds - split.sold.cost)} · their dividends ${fmtRs(split.sold.dividends)}`}
            tone={booked >= 0 ? "positive" : "negative"}
          />
        )}
        <Stat label="Dividends" value={fmtRs(derived.dividendsReceived)} hint={divYieldOnCost != null ? `Dividend yield on cost ${fmtPct(divYieldOnCost, 2)}: Rs ${yearDps.toFixed(2)} a share in ${profile?.declaredLabel ?? "a year"}, on your Rs ${derived.avgCost.toFixed(2)}, before tax` : "No dividend on record for a year"} />
        {hd && (
          <Stat
            label="P&L in dollars"
            value={fmtSignedDollars(hd.totalUsd)}
            hint={`${fmtSignedPct(hd.totalPct != null ? hd.totalPct / 100 : null)} with the dividends these shares earned, against ${fmtSignedPct(rupeeTotalPct)} in rupees · cost ${fmtDollars(hd.costUsd)} at the rates you paid`}
            tone={hd.totalUsd >= 0 ? "positive" : "negative"}
          />
        )}
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

      <Section
        number="02b"
        title="Quality & value"
        description="Quality against price."
        action={
          <Link href="/portfolio?tab=quality" className="font-mono text-[11px] uppercase tracking-stat text-muted hover:text-[var(--accent-deep)]">
            Portfolio quality →
          </Link>
        }
      >
        <Suspense fallback={<Skeleton className="w-full" style={{ height: 260, borderRadius: 10 }} />}>
          <CompanyQualityPanel symbol={symbol} />
        </Suspense>
      </Section>

      <Section
        number="03"
        title="Playbook"
        display="Your thesis, tier, and the numbers to watch."
        description="Which tier it belongs to, your conviction score, the job it does, and the quarterly numbers that tell you the thesis is healing or breaking."
      >
        <HoldingPlaybook
          symbol={symbol}
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
            standsInFor: (holding as any).standsInFor ?? "",
            notes: holding.notes ?? "",
            parked: (holding as any).parked === true,
            parkedNote: (holding as any).parkedNote ?? "",
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

      <Section
        number="08"
        title="What if I buy more?"
        display="Averaging math before you place the order."
        description="New average cost, cash needed with real PSX brokerage, and your weight after the buy — the buy-side mirror of the sell-side CGT preview. Nothing is saved."
      >
        <BuyWhatIf
          shares={derived.shares}
          totalCost={derived.totalCost}
          currentPrice={currentPrice}
          marketValue={marketValue}
          portfolioValue={summary.totalValue}
        />
      </Section>

      <Section
        number="10"
        title="Sell discipline"
        display={disc && disc.fired.length > 0 ? `${disc.fired.length} of your rules ${disc.fired.length === 1 ? "has" : "have"} fired.` : "The exit, pre-committed."}
        description="A position you would not buy today at today's price is a position held by inertia. Set YOUR fair-value band, falsifiable invalidators and stops — the engine checks them without emotion and the Decisions page nags until you act or log a conscious hold."
      >
        <SellPlanPanel
          symbol={symbol}
          price={currentPrice}
          weightPct={currentPercent}
          sharesHeld={derived.shares}
          cumPat3y={disc?.cumPat3y ?? null}
          fired={(disc?.firedRaw ?? []).map((t) => ({ type: t.type, message: t.message, severity: t.severity }))}
          spreadPct={disc?.spreadPct ?? null}
          netRiskFreeLabel={discipline?.netRiskFree.label ?? "risk-free"}
          initialPlan={{
            classification: h.plan?.classification ?? "",
            fvLow: h.plan?.fvLow ?? 0,
            fvBase: h.plan?.fvBase ?? 0,
            fvHigh: h.plan?.fvHigh ?? 0,
            fvMethod: h.plan?.fvMethod ?? "",
            invalidators: (h.plan?.invalidators ?? []).map((i: any) => ({ text: i.text, occurredAt: i.occurredAt ?? "" })),
            timeStopMonths: h.plan?.timeStopMonths ?? 0,
            cumOcf3y: h.plan?.cumOcf3y ?? null,
            openedAt: h.plan?.openedAt ?? "",
            fvHighRaisedCount: h.plan?.fvHighRaisedCount ?? 0,
            targetRaisedCount: h.plan?.targetRaisedCount ?? 0,
            thesisEditCount: h.plan?.thesisEditCount ?? 0,
          }}
          initialRebuy={{
            active: h.rebuyRule?.active ?? false,
            maxPrice: h.rebuyRule?.maxPrice ?? 0,
            requiredConditions: h.rebuyRule?.requiredConditions ?? [],
            reviewOn: h.rebuyRule?.reviewOn ?? "",
          }}
        />
        {derived.shares > 0 && currentPrice > 0 && (
          <div className="mt-5">
            <div className="label-cap mb-2">What would a trim do? Type shares to sell — or the % you want to keep. (FIFO lots, exact CGT — nothing is saved)</div>
            <TrimWhatIf
              symbol={symbol}
              currentPrice={currentPrice}
              lots={buildLots(symbol, transactions as any).openLots}
              positionValue={marketValue}
              portfolioValue={summary.totalValue}
              cgtRatePct={(settings as any).filerStatus === "filer" ? (settings as any).cgtRateFiler : (settings as any).cgtRateNonFiler}
              taxYearLabel={currentTaxYear().label}
              netRiskFreePct={discipline?.netRiskFree.pct ?? null}
              netRiskFreeLabel={discipline?.netRiskFree.label ?? "best MMF net of WHT"}
              equityAfterTaxPct={disc?.spreadPct != null && discipline?.netRiskFree.pct != null ? disc.spreadPct + discipline.netRiskFree.pct : null}
            />
          </div>
        )}
        {symbolDecisions.length > 0 && (
          <div className="mt-5">
            <div className="label-cap mb-2">Every decision you&apos;ve ever made on {symbol}</div>
            <div className="space-y-3">
              {symbolDecisions.map((d: any) => (
                <div key={String(d._id)} className="border-l-2 pl-3 text-[12px]" style={{ borderColor: "var(--rule)" }}>
                  <span className="font-mono font-medium">{String(d.timestamp).slice(0, 10)}</span>{" "}
                  <span className="label-cap">{String(d.action).replace(/_/g, " ")}</span>{" "}
                  <span className="font-mono text-muted">@ {Number(d.priceAtDecision).toFixed(2)}</span>
                  <p className="mt-0.5">{d.rationale}</p>
                  {d.outcomeReview && <p className="text-muted">Graded {d.outcomeReview.decisionQuality}/5 — {d.outcomeReview.lesson || d.outcomeReview.whatHappened}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      {peers.length > 1 && (
        <Section
          number="11"
          title="Sector peers"
          display={`${symbol} against ${peerSector}.`}
          description="Same-sector names from the live 500-stock universe, sorted by earnings yield. Missing figures print as missing — a blank P/E usually means losses, which is information too."
        >
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-t border-b border-ink text-left">
                  <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium">Symbol</th>
                  <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium text-right">P/E</th>
                  <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium text-right">Earnings yield</th>
                  <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium text-right">Dividend yield</th>
                </tr>
              </thead>
              <tbody>
                {peers.map((p) => {
                  const isMe = p.symbol === symbol;
                  return (
                    <tr key={p.symbol} className="border-b border-rule" style={isMe ? { background: "var(--paper-2)" } : undefined}>
                      <td className="px-2 py-1.5">
                        <Link href={`/stock/${p.symbol}`} className={`font-mono hover:text-[var(--accent-deep)] ${isMe ? "font-semibold" : ""}`}>
                          {p.symbol}
                        </Link>
                        {isMe && <span className="ml-2 font-mono text-[9px] uppercase tracking-stat" style={{ color: "var(--accent-deep)" }}>you</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono mono-num">{p.pe != null ? p.pe.toFixed(1) : <span className="text-muted">—</span>}</td>
                      <td className="px-2 py-1.5 text-right font-mono mono-num">{p.ey != null ? `${p.ey.toFixed(1)}%` : <span className="text-muted">—</span>}</td>
                      <td className="px-2 py-1.5 text-right font-mono mono-num">{p.dy != null ? `${p.dy.toFixed(1)}%` : <span className="text-muted">—</span>}</td>
                    </tr>
                  );
                })}
                <tr className="border-b border-ink">
                  <td className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-stat text-muted">Sector median</td>
                  <td className="px-2 py-1.5 text-right font-mono mono-num text-muted">{med(peers.map((p) => p.pe))?.toFixed(1) ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right font-mono mono-num text-muted">{med(peers.map((p) => p.ey)) != null ? `${med(peers.map((p) => p.ey))!.toFixed(1)}%` : "—"}</td>
                  <td className="px-2 py-1.5 text-right font-mono mono-num text-muted">{med(peers.map((p) => p.dy)) != null ? `${med(peers.map((p) => p.dy))!.toFixed(1)}%` : "—"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section
        number="12"
        title="Dividends, bonuses and splits"
        display="What the price did around each one."
        description="Every payout, bonus issue and split on the exchange's own record, with the price against the market in the 20 sessions before the ex-date and the 5 and 20 after, beside the same averages across every listed company."
      >
        <EventRecordCard record={eventRecord} />
      </Section>
    </div>
  );
}
