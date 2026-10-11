import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import type { StrategyView as StrategyData, RatesPrefill } from "@/lib/strategy/data";
import { PHASES, TRANCHE_LEVELS, type StrategyName } from "@/lib/strategy/plan";
import { fmtRs } from "@/lib/format";
import { RatesForm } from "./RatesForm";

// The strategy page's body, from what lib/strategy/data.ts gathered (the
// preview page draws it on sample figures).

const pct = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(d)}%`);
const monthLabel = (m: string) => new Date(m + "-01T00:00:00Z").toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export function StrategyView({ s, prefill }: { s: StrategyData; prefill: RatesPrefill }) {
  const p = s.plan;
  const tone = undefined;
  return (
    <div className="fade-in">
      <PageHeader title="Strategy" subtitle="Buy quality in steps, keep dry powder." />

      <Card title="The plan" action={<span className="text-[12px] text-muted">{s.ratesEntered && s.rates ? monthLabel(s.rates.month) : "Rates not entered"}</span>}>
        <ol className="space-y-1.5 text-[14px] list-decimal pl-5">
          {p.steps.map((x, k) => (
            <li key={k}>{x}</li>
          ))}
        </ol>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 stagger">
        <StatCard label="Market" value={PHASES[p.phase.key].label} tone={tone} delta={p.phase.drawdownPct != null ? `${p.phase.drawdownPct.toFixed(1)}% from high` : undefined} deltaTone="muted" hint={s.kse ? `High ${Math.round(s.kse.high).toLocaleString("en-US")}` : undefined} />
        <StatCard label="Stocks against T-bills" value={p.valuation.verdict ? p.valuation.verdict[0].toUpperCase() + p.valuation.verdict.slice(1) : "—"} delta={p.valuation.premiumPp != null ? `${p.valuation.premiumPp >= 0 ? "+" : ""}${p.valuation.premiumPp.toFixed(1)} pts` : undefined} deltaTone={p.valuation.premiumPp == null ? "muted" : p.valuation.premiumPp >= 0 ? "positive" : "negative"} hint={`${pct(p.valuation.earningsYieldPct)} vs ${pct(p.valuation.tbillPct)}`} />
        <StatCard label="In stocks" value={pct(p.allocation.stocksNowPct, 0)} delta={`target ${pct(p.allocation.stocksTargetPct, 0)}`} deltaTone="muted" hint={s.profile.risk[0].toUpperCase() + s.profile.risk.slice(1)} />
        <StatCard label="Dry powder" value={fmtRs(s.book.cashLike + s.book.fixedIncome)} delta={pct(p.allocation.dryNowPct, 0)} deltaTone="muted" hint={`T-bills & sukuks ${fmtRs(s.book.fixedIncome)}`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-3">
        <Card title="Buying in steps" action={<span className="text-[12px] text-muted">{p.allocation.room > 0 ? `${fmtRs(p.allocation.room)} to put to work` : "Nothing to put to work"}</span>}>
          <table className="table-zar">
            <thead>
              <tr><th>Step</th><th className="text-right">KSE-100 at</th><th className="text-right">Below the high</th><th className="text-right">Amount</th><th>Status</th></tr>
            </thead>
            <tbody>
              {p.tranches.map((t) => (
                <tr key={t.n}>
                  <td>{t.n}</td>
                  <td className="text-right mono-num">{t.kseLevel?.toLocaleString("en-US") ?? "—"}</td>
                  <td className="text-right mono-num">{t.drawdownPct}%</td>
                  <td className="text-right mono-num">{fmtRs(t.amount)}</td>
                  <td>{t.amount <= 0 ? <span className="text-muted">—</span> : <span className="pill" data-tone={t.due ? "positive" : "muted"}>{t.due ? "Due" : "Waiting"}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Where the dry powder waits" action={<span className="text-[12px] text-muted">after {pct(s.rates?.taxPct, 0)} tax</span>}>
          {p.parking.options.length === 0 ? (
            <p className="text-[13px] text-muted">Enter this month&apos;s rates.</p>
          ) : (
            <>
              <table className="table-zar">
                <thead>
                  <tr><th>Where</th><th className="text-right">Yield</th><th className="text-right">After tax</th><th>Money back</th></tr>
                </thead>
                <tbody>
                  {p.parking.options.map((o) => (
                    <tr key={o.key}>
                      <td className={o.best ? "font-semibold" : undefined}>{o.label}{o.best && <span className="pill ml-2" data-tone="positive">use</span>}</td>
                      <td className="text-right mono-num">{pct(o.yieldPct, 2)}</td>
                      <td className="text-right mono-num">{pct(o.afterTaxPct, 2)}</td>
                      <td className="text-muted">{o.liquidity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Card>
      </div>

      <Card className="mt-3" title="Quality" action={<Link href="/portfolio?tab=quality" className="text-[12px] link-underline">The quality tab</Link>}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <NameList title="Buy" empty="None now" rows={p.quality.add} show={(n) => `${n.grade}${n.marginOfSafetyPct != null && n.marginOfSafetyPct >= 20 ? ` · ${n.marginOfSafetyPct.toFixed(0)}% under fair value` : ""}`} />
          <NameList title="Reconsider" empty="None" rows={p.quality.reconsider} show={(n) => `${n.grade ?? "—"}`} />
          <NameList title="Yield above T-bills" empty="None" rows={p.quality.income} show={(n) => pct(n.dividendYieldPct)} />
        </div>
      </Card>

      <Card className="mt-3" title="This month's rates" action={<Link href="/settings" className="text-[12px] link-underline">Settings</Link>}>
        <RatesForm values={prefill.values} sources={prefill.sources} entered={prefill.entered} monthLabel={monthLabel(prefill.values.month)} />
        {s.history.length > 0 && (
          <div className="overflow-x-auto -mx-2 mt-5">
            <table className="table-zar">
              <thead>
                <tr><th>Month</th><th className="text-right">Policy</th><th className="text-right">T-bill 3M</th><th className="text-right">6M</th><th className="text-right">12M</th><th className="text-right">Sukuk</th><th className="text-right">Money market</th><th className="text-right">Savings</th><th className="text-right">Inflation</th></tr>
              </thead>
              <tbody>
                {s.history.slice(0, 12).map((h) => (
                  <tr key={h.month}>
                    <td>{monthLabel(h.month)}</td>
                    <td className="text-right mono-num">{pct(h.policyPct, 2)}</td>
                    <td className="text-right mono-num">{pct(h.tbill3mPct, 2)}</td>
                    <td className="text-right mono-num">{pct(h.tbill6mPct, 2)}</td>
                    <td className="text-right mono-num">{pct(h.tbill12mPct, 2)}</td>
                    <td className="text-right mono-num">{pct(h.sukukPct, 2)}</td>
                    <td className="text-right mono-num">{pct(h.moneyMarketPct, 2)}</td>
                    <td className="text-right mono-num">{pct(h.savingsPct, 2)}</td>
                    <td className="text-right mono-num">{pct(h.inflationPct, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <details className="mt-3 text-[12.5px] text-muted">
        <summary className="cursor-pointer select-none">Rules</summary>
        <ul className="mt-2 space-y-1 pl-4 list-disc">
          <li>Phase: KSE-100 below its high. 5% pullback, 10% correction, 20% mandi, 30% crash.</li>
          <li>Cheap: stocks earn 3+ pts over T-bills. Dear: 1+ pt under.</li>
          <li>Stocks: 40 / 60 / 80% by risk; −10 or −20 for a shorter horizon; ±10 cheap or dear; +5 mandi, +10 crash.</li>
          <li>Steps: a quarter at {TRANCHE_LEVELS.join(", ")}% below the high.</li>
          <li>Park: next steps&apos; money liquid; the rest longer when rates fall.</li>
          <li>Buy grade A/B below the market&apos;s P/E or 20% under fair value. Not advice.</li>
        </ul>
      </details>
    </div>
  );
}

function NameList({ title, rows, empty, show }: { title: string; rows: StrategyName[]; empty: string; show: (n: StrategyName) => string }) {
  return (
    <div>
      <div className="label-cap mb-2">{title}</div>
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-muted">{empty}</p>
      ) : (
        <ul className="space-y-1.5 text-[13px]">
          {rows.map((n) => (
            <li key={n.symbol}>
              <Link href={n.held ? `/holdings/${n.symbol}` : `/stock/${n.symbol}`} className="font-semibold hover:underline">{n.symbol}</Link>
              {n.held && <span className="text-[10.5px] text-muted"> held</span>}
              <span className="text-muted"> · {show(n)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
