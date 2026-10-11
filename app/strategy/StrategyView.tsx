import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { KseZonesChart } from "@/components/charts/KseZonesChart";
import type { StrategyView as StrategyData, RatesPrefill } from "@/lib/strategy/data";
import { PHASES, zoneRange, type StrategyName } from "@/lib/strategy/plan";
import { fmtRs } from "@/lib/format";
import { RatesForm } from "./RatesForm";
import { BuyListCard, HoldingsCard, ResearchSector, SectorsCard, AnalogsCard, SensitivityCard, RecordCard, CalibrationCard, LearningCard } from "./ModelSections";

// The strategy page's body, from what lib/strategy/data.ts gathered (the
// preview page draws it on sample figures), in three tabs: the plan, the
// research on every share of the ticked sectors, and the model.

export type StrategyTab = "plan" | "research" | "model";
const TABS: Array<{ key: StrategyTab; label: string }> = [
  { key: "plan", label: "Plan" },
  { key: "research", label: "Research" },
  { key: "model", label: "Model" },
];

const pct = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(d)}%`);
const monthLabel = (m: string) => new Date(m + "-01T00:00:00Z").toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export function StrategyView({ s, prefill, tab = "plan" }: { s: StrategyData; prefill: RatesPrefill; tab?: StrategyTab }) {
  return (
    <div className="fade-in">
      <PageHeader title="Strategy" subtitle="Buy quality in zones, keep dry powder." />
      <div className="tabs mb-4">
        {TABS.map((t) => (
          <Link key={t.key} href={t.key === "plan" ? "/strategy" : `/strategy?tab=${t.key}`} data-active={tab === t.key}>
            {t.label}
          </Link>
        ))}
      </div>
      {tab === "research" ? <ResearchTab s={s} /> : tab === "model" ? <ModelTab s={s} /> : <PlanTab s={s} prefill={prefill} />}
    </div>
  );
}

function ResearchTab({ s }: { s: StrategyData }) {
  const r = s.research;
  if (r.watched.sectors === 0) {
    return <Card><p className="text-[13px] text-muted">Tick sectors on the <Link href="/watchlist" className="link-underline">Watchlist</Link> and every share in them is researched here.</p></Card>;
  }
  return (
    <div>
      <p className="text-[12.5px] text-muted">
        {r.watched.shares} shares in {r.watched.sectors} sectors{r.asOf ? `, prices of ${r.asOf}` : ""}. Usual P/E: its median P/E when the policy rate was near today&apos;s {r.rateNow ?? "—"}%. <Link href="/watchlist" className="link-underline">Change sectors</Link>
      </p>
      {r.sectors.map((sec, k) => (
        <ResearchSector key={sec.sector} sec={sec} m={s.macro} rate={r.rateNow} open={k < 2} />
      ))}
      <Rules />
    </div>
  );
}

function ModelTab({ s }: { s: StrategyData }) {
  if (!s.macro) return <Card><p className="text-[13px] text-muted">The model has not been sent to the server yet.</p></Card>;
  return (
    <div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <SectorsCard m={s.macro} />
        <AnalogsCard m={s.macro} />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-3">
        <CalibrationCard m={s.macro} />
        <LearningCard m={s.macro} />
      </div>
      <div className="mt-3"><SensitivityCard m={s.macro} /></div>
      <div className="mt-3"><RecordCard m={s.macro} /></div>
    </div>
  );
}

function Rules() {
  return (
    <details className="mt-4 text-[12.5px] text-muted">
      <summary className="cursor-pointer select-none">How the calls are made</summary>
      <ul className="mt-2 space-y-1 pl-4 list-disc">
        <li>One number decides: what a share should do against the market over the next 3 months. It comes from the model&apos;s rank and what each rank did on years the model never saw (2008 on).</li>
        <li>Every close, each share&apos;s reading is saved. Three months on it is checked against what happened, and the expected returns move toward the real outcomes.</li>
        <li>P/E against its usual counts only if the data shows it predicts. It is tested again every day; so far it has not.</li>
        <li>Buy: expected over 1% (a trade&apos;s costs). Now at or under the 20-day buy zone, else at it. Avoid: under −1%. Thin shares (outside the 150 most traded) get no call.</li>
        <li>Held only. Sell: under −1%. Take profit: under 0, into the 20-day sell zone.</li>
        <li>Usual P/E: its median quarter-end P/E with the policy rate within 2.5 points of today&apos;s. Yields: from the exchange&apos;s own dividend record. Not advice.</li>
      </ul>
    </details>
  );
}

function PlanTab({ s, prefill }: { s: StrategyData; prefill: RatesPrefill }) {
  const p = s.plan;
  const withAmounts = p.tranches.some((t) => t.amount > 0);
  return (
    <div>
      <Card title="The plan" action={<span className="text-[12px] text-muted">{s.ratesEntered && s.rates ? monthLabel(s.rates.month) : "Rates not entered"}</span>}>
        <ol className="space-y-1.5 text-[14px] list-decimal pl-5">
          {p.steps.map((x, k) => (
            <li key={k}>{x}</li>
          ))}
        </ol>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 stagger">
        <StatCard label="Market" value={PHASES[p.phase.key].label} delta={p.phase.drawdownPct != null ? `${p.phase.drawdownPct.toFixed(1)}% from high` : undefined} deltaTone="muted" hint={s.model?.state ? `Model: ${s.model.state.toLowerCase()}` : s.kse ? `High ${Math.round(s.kse.high).toLocaleString("en-US")}` : undefined} />
        <StatCard label="Stocks against T-bills" value={p.valuation.verdict ? p.valuation.verdict[0].toUpperCase() + p.valuation.verdict.slice(1) : "—"} delta={p.valuation.premiumPp != null ? `${p.valuation.premiumPp >= 0 ? "+" : ""}${p.valuation.premiumPp.toFixed(1)} pts` : undefined} deltaTone={p.valuation.premiumPp == null ? "muted" : p.valuation.premiumPp >= 0 ? "positive" : "negative"} hint={`${pct(p.valuation.earningsYieldPct)} vs ${pct(p.valuation.tbillPct)}`} />
        <StatCard label="In stocks" value={pct(p.allocation.stocksNowPct, 0)} delta={`target ${pct(p.allocation.stocksTargetPct, 0)}`} deltaTone="muted" hint={s.profile.risk[0].toUpperCase() + s.profile.risk.slice(1)} />
        <StatCard label="Dry powder" value={fmtRs(s.book.cashLike + s.book.fixedIncome)} delta={pct(p.allocation.dryNowPct, 0)} deltaTone="muted" hint={`T-bills & sukuks ${fmtRs(s.book.fixedIncome)}`} />
      </div>

      <BuyListCard r={s.research} />
      <HoldingsCard r={s.research} />

      <Card className="mt-3" title="KSE-100 buy zones" action={<span className="text-[12px] text-muted">{p.allocation.room > 0 ? `${fmtRs(p.allocation.room)} to put to work` : "No buying now"}</span>}>
        {s.chart.length > 1 && (
          <div className="mb-4">
            <KseZonesChart points={s.chart} zones={p.tranches.filter((t) => t.low != null && t.high != null).map((t) => ({ n: t.n, low: t.low!, high: t.high!, due: t.due }))} high={s.kse?.high ?? null} />
          </div>
        )}
        <div className="overflow-x-auto -mx-2">
          <table className="table-zar">
            <thead>
              <tr><th>Zone</th><th>KSE-100</th>{withAmounts && <th className="text-right">Amount</th>}<th></th></tr>
            </thead>
            <tbody>
              {p.tranches.map((t) => (
                <tr key={t.n}>
                  <td className="font-semibold">{t.n}</td>
                  <td>
                    <div className="mono-num whitespace-nowrap">{zoneRange(t)}</div>
                    <div className="text-[11.5px] text-muted">{t.why}</div>
                  </td>
                  {withAmounts && <td className="text-right mono-num">{t.amount > 0 ? fmtRs(t.amount) : <span className="text-muted">—</span>}</td>}
                  <td><span className="pill" data-tone={t.due ? "positive" : "muted"}>{t.due ? "Reached" : "Waiting"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[12px] text-muted mt-3">
          {p.tranches.some((t) => t.kind === "model") ? "Zone 1 is the Model page's, for the next 20 days. " : ""}Telegram tells you when the KSE-100 reaches a zone.
          {s.book.cashLike + s.book.fixedIncome <= 0 && (
            <> No cash, funds or T-bills recorded: <Link href="/portfolio?tab=cash" className="link-underline">add them on the Cash tab</Link>.</>
          )}
        </p>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-3">
        <Card title="Where the dry powder waits" action={<span className="text-[12px] text-muted">after {pct(s.rates?.taxPct, 0)} tax</span>}>
          {p.parking.options.length === 0 ? (
            <p className="text-[13px] text-muted">Enter this month&apos;s rates.</p>
          ) : (
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
          )}
        </Card>

        <Card title="Quality" action={<Link href="/portfolio?tab=quality" className="text-[12px] link-underline">The quality tab</Link>}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <NameList title="Reconsider" empty="None" rows={p.quality.reconsider} show={(n) => `${n.grade ?? "—"}`} />
            <NameList title="Yield above T-bills" empty="None" rows={p.quality.income} show={(n) => pct(n.dividendYieldPct)} />
          </div>
        </Card>
      </div>

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
          <li>Zones: the model&apos;s (next 20 days), past lows, a bad quarter (1 in 20), cheap against T-bills. More money in deeper zones.</li>
          <li>Park: next zones&apos; money liquid; the rest longer when rates fall.</li>
          <li>Which shares: the Research tab, from the sectors ticked on the Watchlist. Not advice.</li>
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
