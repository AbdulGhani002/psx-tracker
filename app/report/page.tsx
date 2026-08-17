import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Stat, StatRow } from "@/components/ui/Stat";
import { PrintButton } from "./PrintButton";
import {
  getPortfolioSummary,
  getNetWorth,
  getMutualFundsValued,
  getSavingsValued,
  getCashSummary,
} from "@/lib/data";
import { getRatings, getFlows } from "@/lib/analytics";
import { getUsdPkr } from "@/lib/fx";
import { fmtRs, fmtUsd, fmtSignedRs, fmtSignedPct, fmtPct, fmtDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

// A statement you can hand to anyone: everything valued as of now, PKR + USD,
// with the AI's read on each holding and the market context. Print CSS strips
// the app chrome so "Print / Save as PDF" produces a clean document.
export default async function ReportPage() {
  const [summary, netWorth, funds, savings, cash, usdPkr, ratings, flows] = await Promise.all([
    getPortfolioSummary(),
    getNetWorth(),
    getMutualFundsValued(),
    getSavingsValued(),
    getCashSummary(),
    getUsdPkr(),
    getRatings(500),
    getFlows(90),
  ]);
  const usd = (rs: number) => (usdPkr ? `≈ ${fmtUsd(rs, usdPkr, false)}` : undefined);
  const ratingBySym = new Map((ratings?.results ?? []).map((r) => [r.symbol, r]));
  const active = summary.positions.filter((p) => p.shares > 0);
  const totalReturn = summary.unrealizedPL + summary.realizedPL + summary.dividendsTotal;

  return (
    <div className="fade-in">
      <style
        dangerouslySetInnerHTML={{
          __html: `@media print {
            header, footer, .no-print { display: none !important; }
            main { max-width: 100% !important; padding: 0 !important; }
            body { background: #fff !important; color: #111 !important; }
          }`,
        }}
      />
      <PageHeader
        eyebrow="Portfolio · Statement"
        title="Your portfolio statement."
        subtitle={`Everything you own at current value — generated ${fmtDateTime(new Date())}. Use Print / Save as PDF for your records or the FBR file.`}
      >
        <span className="no-print"><PrintButton /></span>
      </PageHeader>

      <StatRow>
        <Stat label="Net worth" value={fmtRs(netWorth.total)} size="lg" hint={usd(netWorth.total)} />
        <Stat label="Equities" value={fmtRs(netWorth.equity)} hint={usd(netWorth.equity)} />
        <Stat label="Funds" value={fmtRs(netWorth.funds)} hint={usd(netWorth.funds)} />
        <Stat label="Savings" value={fmtRs(netWorth.savings)} hint={usd(netWorth.savings)} />
        <Stat label="Unrealised P/L" value={fmtSignedRs(summary.unrealizedPL)} tone={summary.unrealizedPL >= 0 ? "positive" : "negative"} />
        <Stat label="Total return" value={fmtSignedRs(totalReturn)} tone={totalReturn >= 0 ? "positive" : "negative"} hint={summary.totalCost > 0 ? fmtSignedPct(totalReturn / summary.totalCost, 1) : undefined} />
      </StatRow>

      <Section number="01" title="Equity holdings" description="Each position at the latest PSX price, with cost basis and the AI's current read.">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-t border-ink border-b border-ink">
                {["Symbol", "Shares", "Avg cost", "Price", "Value", "≈ USD", "Unrealised", "AI rating"].map((h, i) => (
                  <th key={h} className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium" style={{ textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {active.map((p) => {
                const r = ratingBySym.get(p.symbol);
                return (
                  <tr key={p.symbol} className="border-b border-rule">
                    <td className="px-2 py-1.5 font-mono font-medium">{p.symbol}</td>
                    <td className="px-2 py-1.5 text-right font-mono mono-num">{p.shares}</td>
                    <td className="px-2 py-1.5 text-right font-mono mono-num text-muted">{fmtRs(p.avgCost, true)}</td>
                    <td className="px-2 py-1.5 text-right font-mono mono-num">{fmtRs(p.currentPrice, true)}</td>
                    <td className="px-2 py-1.5 text-right font-mono mono-num">{fmtRs(p.marketValue)}</td>
                    <td className="px-2 py-1.5 text-right font-mono mono-num text-muted">{usdPkr ? fmtUsd(p.marketValue, usdPkr, false) : "—"}</td>
                    <td className="px-2 py-1.5 text-right font-mono mono-num" style={{ color: p.unrealizedPL >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedPct(p.unrealizedPct)}</td>
                    <td className="px-2 py-1.5 text-right font-mono mono-num">{r ? `${r.overall}/100 ${r.verdict}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section number="02" title="Funds, savings & cash" description="Mutual funds at live NAV with their real MUFAP annual yields; savings at accrued value.">
        <div className="grid md:grid-cols-3 gap-6 text-[13px]">
          <div>
            <div className="label-cap mb-2">Mutual funds</div>
            {funds.length === 0 ? <p className="text-muted">None.</p> : funds.map((f) => (
              <div key={f._id} className="flex justify-between gap-3 py-1 border-b border-rule">
                <span className="truncate">{f.name}{f.liveAnnualYieldPct != null ? ` · ${f.liveAnnualYieldPct.toFixed(2)}%/yr` : ""}</span>
                <span className="font-mono mono-num">{fmtRs(f.value)}</span>
              </div>
            ))}
          </div>
          <div>
            <div className="label-cap mb-2">Savings</div>
            {savings.length === 0 ? <p className="text-muted">None.</p> : savings.map((s: any) => (
              <div key={s._id} className="flex justify-between gap-3 py-1 border-b border-rule">
                <span className="truncate">{s.name}</span>
                <span className="font-mono mono-num">{fmtRs(s.currentValue ?? s.value ?? 0)}</span>
              </div>
            ))}
          </div>
          <div>
            <div className="label-cap mb-2">Income</div>
            <div className="flex justify-between gap-3 py-1 border-b border-rule">
              <span>Dividends this tax year</span>
              <span className="font-mono mono-num">{fmtRs(summary.dividendsYTD)}</span>
            </div>
          </div>
        </div>
      </Section>

      {flows && flows.series?.length > 0 && (
        <Section number="03" title="Market context" description="Official NCCPL foreign-flow record over the report window — the tide your portfolio swims in.">
          <p className="text-[14px] max-w-[70ch]">
            Over the last {flows.days} sessions foreigners were net {flows.cumulative_fipi >= 0 ? "buyers" : "sellers"} of{" "}
            <strong>${Math.abs(flows.cumulative_fipi).toFixed(1)}m</strong>; the latest session was{" "}
            {flows.fipi_today >= 0 ? "+" : "−"}${Math.abs(flows.fipi_today).toFixed(1)}m with a {flows.streak}-session {flows.streak_side} streak.
            {usdPkr ? ` USD/PKR used in this statement: Rs ${usdPkr.toFixed(2)}.` : ""}
          </p>
        </Section>
      )}

      <p className="text-[11px] text-muted mt-10 max-w-[70ch]">
        Prices from PSX, fund NAVs and yields from MUFAP, foreign flows from NCCPL (via scstrade), FX from open interbank sources. Figures are current values, not advice.
      </p>
    </div>
  );
}
