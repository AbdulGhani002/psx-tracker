import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { Stat, StatRow } from "@/components/ui/Stat";
import { Table, type Column } from "@/components/ui/Table";
import { Card } from "@/components/ui/Card";
import {
  getNetWorth,
  getPortfolioSummary,
  getMutualFundsValued,
  getSavingsValued,
  getFbrPack,
  getPmexOverview,
  checkDataAvailability,
} from "@/lib/data";
import { financialYearOf } from "@/lib/calculations/pmex-summary";
import { currentTaxYear } from "@/lib/dates";
import { fmtRs, fmtUsd, fmtSignedRs, fmtPct } from "@/lib/format";
import { getUsdPkr } from "@/lib/fx";
import type { PositionRow } from "@/lib/calculations";
import { computeBenchmarkCached } from "@/lib/feeds/benchmark";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { WORLD_INDICES, type WorldIndexKey } from "@/lib/timeseries/portfolio-history";

export const dynamic = "force-dynamic";

type MonthlyPoint = Record<string, number | null> & { date?: never };
type MonthlyRel = { month: string; you: number | null; kse: number | null; rel: number | null; youTR: number | null; sp500: number | null; ndx100: number | null; ftse100: number | null };

// Month-end relative performance + drawdown, derived from the same daily
// benchmark series the overview chart draws. Price-only vs the indices is the
// like-for-like frame (indices as quoted exclude dividends); the TR column is
// your true return with dividends reinvested.
function monthlyRelative(points: Array<{ date: string } & Record<string, unknown>>) {
  const keys = ["portfolio", "portfolioTR", "kse100", "sp500", "ndx100", "ftse100"] as const;
  const byMonth = new Map<string, MonthlyPoint>();
  for (const p of points) {
    const rec: MonthlyPoint = {};
    for (const k of keys) rec[k] = (p[k] as number | null) ?? null;
    byMonth.set(p.date.slice(0, 7), rec); // last point of each month wins
  }
  const months = [...byMonth.keys()].sort();
  const rows: MonthlyRel[] = [];
  for (let i = 1; i < months.length; i++) {
    const prev = byMonth.get(months[i - 1])!;
    const cur = byMonth.get(months[i])!;
    const ret = (k: (typeof keys)[number]) => {
      const a = cur[k];
      const b = prev[k];
      return a != null && b != null && b > 0 ? (a / b - 1) * 100 : null;
    };
    const you = ret("portfolio");
    const kse = ret("kse100");
    rows.push({
      month: months[i],
      you,
      kse,
      rel: you != null && kse != null ? you - kse : null,
      youTR: ret("portfolioTR"),
      sp500: ret("sp500"),
      ndx100: ret("ndx100"),
      ftse100: ret("ftse100"),
    });
  }
  return rows.reverse(); // newest first
}

function maxDrawdownPct(points: Array<{ portfolioTR: number | null }>): number | null {
  let peak = -Infinity;
  let worst = 0;
  let seen = false;
  for (const p of points) {
    if (p.portfolioTR == null) continue;
    seen = true;
    peak = Math.max(peak, p.portfolioTR);
    if (peak > 0) worst = Math.min(worst, (p.portfolioTR / peak - 1) * 100);
  }
  return seen ? worst : null;
}

export default async function WealthPage() {
  const avail = await checkDataAvailability();
  const [netWorth, summary, funds, savings, usdPkr, benchWrap] = await Promise.all([
    getNetWorth(),
    getPortfolioSummary(),
    getMutualFundsValued(),
    getSavingsValued(),
    getUsdPkr(),
    getCurrentUserId()
      .then((uid) => (uid ? computeBenchmarkCached("ALL", uid) : null))
      .catch(() => null),
  ]);
  const bench = benchWrap?.series ?? null;
  const monthly = bench ? monthlyRelative(bench.points as any).slice(0, 12) : [];

  // Financial-year reconciliation across every asset class. Pakistan's FY and
  // tax year are the same window (1 July .. 30 June), so the FBR pack's FIFO
  // disposals and the PMEX roll-up line up without any re-basing.
  const thisFy = financialYearOf(new Date().toISOString().slice(0, 10)).endYear;
  const [eqNow, eqPrev, pmexNow, pmexPrev] = await Promise.all([
    getFbrPack(thisFy).catch(() => null),
    getFbrPack(thisFy - 1).catch(() => null),
    getPmexOverview(thisFy).catch(() => null),
    getPmexOverview(thisFy - 1).catch(() => null),
  ]);

  const fyCols = [
    { label: `FY${thisFy}`, eq: eqNow, pmex: pmexNow, current: true },
    { label: `FY${thisFy - 1}`, eq: eqPrev, pmex: pmexPrev, current: false },
  ];
  const fyRows: Array<{ label: string; hint: string; values: Array<number | null> }> = [
    {
      label: "Equities — realised",
      hint: "FIFO disposals settled in the year",
      values: fyCols.map((c) => c.eq?.cgt.netGain ?? null),
    },
    {
      label: "Equities — dividends (net)",
      hint: "after withholding and zakat",
      values: fyCols.map((c) => c.eq?.divTotals.net ?? null),
    },
    {
      label: "PMEX — realised",
      hint: "contracts closed in the year, after commission",
      values: fyCols.map((c) => c.pmex?.summary.realised.net ?? null),
    },
    {
      label: "PMEX — open (mark)",
      hint: "contracts still held, moves until closed",
      values: fyCols.map((c) => (c.current ? c.pmex?.summary.open.net ?? null : null)),
    },
  ];
  const fyTotals = fyCols.map((_, i) => fyRows.reduce((s, r) => s + (r.values[i] ?? 0), 0));
  const fyTaxRows = [
    { label: "CGT on equities", values: fyCols.map((c) => c.eq?.cgt.cgt ?? null) },
    { label: "CGT on PMEX contracts", values: fyCols.map((c) => c.pmex?.summary.realised.cgt ?? null) },
    { label: "Dividend tax withheld", values: fyCols.map((c) => c.eq?.divTotals.wht ?? null) },
  ];
  const drawdown = bench ? maxDrawdownPct(bench.points) : null;
  const cumYou = bench?.returns?.portfolio ?? null;
  const cumTR = bench?.returns?.portfolioTR ?? null;
  const cumKse = bench?.returns?.kse100 ?? null;
  // World scoreboard for the same window: each index in its own currency, gap
  // vs YOUR price-only return. USD/PKR's move carries the currency story.
  const pctOf = (v: number | null | undefined) => (v == null ? null : v * 100);
  const worldRows: Array<{ key: string; label: string; ccy: string; ret: number | null }> = [
    { key: "kse100", label: "KSE-100", ccy: "PKR", ret: pctOf(bench?.returns?.kse100) },
    { key: "sp500", label: "S&P 500", ccy: "USD", ret: pctOf(bench?.returns?.sp500) },
    ...(Object.keys(WORLD_INDICES) as WorldIndexKey[]).map((k) => ({
      key: k,
      label: WORLD_INDICES[k].label,
      ccy: WORLD_INDICES[k].ccy,
      ret: pctOf(bench?.returns?.[k]),
    })),
    { key: "gold", label: "Gold (in PKR)", ccy: "PKR", ret: pctOf(bench?.returns?.gold) },
  ];
  const usdPkrMove = pctOf(bench?.returns?.usdpkr);

  const ty = currentTaxYear();
  const equityRows = summary.positions.filter((p) => p.shares > 0);
  const totalCost = equityRows.reduce((s, p) => s + p.totalCost, 0);
  const totalGain = netWorth.equity - totalCost;
  const usd = (rs: number) => (usdPkr ? `≈ ${fmtUsd(rs, usdPkr, false)}` : undefined);

  const cols: Column<PositionRow>[] = [
    { key: "sym", header: "Symbol", render: (p) => <span className="font-mono font-medium">{p.symbol}</span> },
    { key: "sector", header: "Sector", render: (p) => <span className="text-[12px] text-muted">{p.sector}</span> },
    { key: "cost", header: "Cost", align: "right", mono: true, render: (p) => fmtRs(p.totalCost) },
    { key: "value", header: "Market value", align: "right", mono: true, render: (p) => fmtRs(p.marketValue) },
    { key: "gain", header: "Unrealised", align: "right", mono: true, render: (p) => <span style={{ color: p.unrealizedPL >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedRs(p.unrealizedPL)}</span> },
  ];

  return (
    <div>
      <PageHeader
        eyebrow={`Wealth · ${ty.fbrName}`}
        title="Your statement of assets."
        subtitle={`A snapshot for the FBR wealth statement — all assets at current value, with cost basis. The tax year ends 30 June ${ty.endYear}. Print this page for your records.`}
      />
      {!avail.available && <SetupBanner reason={avail.reason} />}

      <StatRow>
        <Stat label="Net worth" value={fmtRs(netWorth.total)} size="lg" hint={usd(netWorth.total)} />
        <Stat label="Equity cost" value={fmtRs(totalCost)} hint={usd(totalCost)} />
        <Stat label="Equity value" value={fmtRs(netWorth.equity)} hint={usd(netWorth.equity)} />
        <Stat label="Unrealised gain" value={fmtSignedRs(totalGain)} tone={totalGain >= 0 ? "positive" : "negative"} />
        <Stat label="Funds" value={fmtRs(netWorth.funds)} />
        <Stat label="Savings" value={fmtRs(netWorth.savings)} />
      </StatRow>

      <Section number="01" title="Assets at a glance" display="Where it all sits.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {netWorth.breakdown.map((b) => (
            <Card key={b.label}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="label-cap">{b.label}</div>
                  <div className="text-[11px] text-muted font-mono mt-1">
                    {netWorth.total > 0 ? fmtPct(b.value / netWorth.total, 1) : "—"} of net worth
                  </div>
                </div>
                <div className="font-display mono-num text-[22px]" style={{ fontVariationSettings: "'opsz' 144" }}>
                  {fmtRs(b.value)}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      <Section
        number="02"
        title="The financial year, reconciled"
        display="Stocks, funds and PMEX in one column."
        description="Pakistan's financial year runs 1 July to 30 June, and it is also the tax year — so equity disposals, dividends and PMEX contracts all fall in the same window with no re-basing. Realised means the money is banked; open marks still move. Mutual funds carry no realised line because units are only crystallised when you redeem them."
      >
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full font-mono text-[13px]">
              <thead>
                <tr className="label-cap border-b border-ink">
                  <th className="text-left py-2 pr-3">Source</th>
                  {fyCols.map((c) => (
                    <th key={c.label} className="text-right py-2 pl-3">
                      {c.label}
                      {c.current ? " (running)" : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fyRows.map((r) => (
                  <tr key={r.label} className="border-b border-rule">
                    <td className="py-2 pr-3">
                      <div>{r.label}</div>
                      <div className="text-[11px] text-muted">{r.hint}</div>
                    </td>
                    {r.values.map((v, i) => (
                      <td key={i} className="text-right py-2 pl-3">
                        {v == null ? <span className="text-muted">—</span> : (
                          <span style={{ color: v >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedRs(v)}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="border-b-2 border-ink">
                  <td className="py-2 pr-3 font-medium">Total for the year</td>
                  {fyTotals.map((t, i) => (
                    <td key={i} className="text-right py-2 pl-3 font-medium" style={{ color: t >= 0 ? "var(--positive)" : "var(--negative)" }}>
                      {fmtSignedRs(t)}
                    </td>
                  ))}
                </tr>
                {fyTaxRows.map((r) => (
                  <tr key={r.label} className="border-b border-rule">
                    <td className="py-2 pr-3 text-muted">{r.label}</td>
                    {r.values.map((v, i) => (
                      <td key={i} className="text-right py-2 pl-3 text-muted">
                        {v == null ? "—" : fmtRs(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 pt-4 border-t border-rule text-[12px] text-muted">
            Current holdings are worth {fmtRs(netWorth.equity)} in equities and {fmtRs(netWorth.funds)} in funds, with{" "}
            {fmtSignedRs(totalGain)} unrealised on the equity book. That unrealised figure is deliberately not added
            above — it is not this year&apos;s profit until you sell.
          </div>
        </Card>
      </Section>

      <Section number="03" title="Listed equities" display="Holding by holding.">
        <Table columns={cols} rows={equityRows} rowKey={(p) => p.symbol} empty="No equities." />
      </Section>

      {(pmexNow?.trades.length ?? 0) > 0 && (
        <Section number="04" title="PMEX contracts" display="What is still open.">
          <Table
            columns={[
              { key: "sym", header: "Instrument", render: (t: any) => <span className="font-mono font-medium">{t.symbol}</span> },
              { key: "side", header: "Side", render: (t: any) => <span className="text-[12px] text-muted">{t.side}</span> },
              { key: "lots", header: "Lots", align: "right", mono: true, render: (t: any) => String(t.lots) },
              { key: "exp", header: "Exposure", align: "right", mono: true, render: (t: any) => fmtRs(t.exposure) },
              {
                key: "pl",
                header: "P/L",
                align: "right",
                mono: true,
                render: (t: any) => <span style={{ color: t.netPL >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedRs(t.netPL)}</span>,
              },
            ]}
            rows={pmexNow!.trades.filter((t) => t.isOpen)}
            rowKey={(t: any) => t._id}
            empty="No open contracts."
          />
        </Section>
      )}

      {funds.length > 0 && (
        <Section number="05" title="Mutual funds" display="At today's NAV.">
          <Table
            columns={[
              { key: "name", header: "Fund", render: (f: any) => <span className="text-[13px]">{f.name}</span> },
              { key: "units", header: "Units", align: "right", mono: true, render: (f: any) => f.units.toLocaleString() },
              { key: "nav", header: "NAV", align: "right", mono: true, render: (f: any) => fmtRs(f.nav, true) },
              { key: "value", header: "Value", align: "right", mono: true, render: (f: any) => fmtRs(f.value) },
            ]}
            rows={funds}
            rowKey={(f: any) => f._id}
            empty=""
          />
        </Section>
      )}

      {savings.length > 0 && (
        <Section number="06" title="Savings" display="Accrued balances.">
          <Table
            columns={[
              { key: "name", header: "Account", render: (a: any) => <span className="text-[13px]">{a.name}</span> },
              { key: "rate", header: "Rate", align: "right", mono: true, render: (a: any) => `${a.ratePercent}%` },
              { key: "bal", header: "Balance", align: "right", mono: true, render: (a: any) => fmtRs(a.balance) },
            ]}
            rows={savings}
            rowKey={(a: any) => a._id}
            empty=""
          />
        </Section>
      )}

      {monthly.length > 0 && (
        <Section
          number="07"
          title="You vs the world"
          display="Did the stock-picking earn its keep?"
          description="Month by month against KSE-100, S&P 500, NASDAQ 100 and FTSE 100, with the full scoreboard below. Like-for-like means price-only (indices as quoted exclude dividends) and each index in its own currency; 'with divs' is your true total return."
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <Stat label="You (price, window)" value={cumYou != null ? `${cumYou >= 0 ? "+" : ""}${cumYou.toFixed(1)}%` : "—"} tone={cumYou != null && cumYou >= 0 ? "positive" : "negative"} />
            <Stat label="KSE-100 (window)" value={cumKse != null ? `${cumKse >= 0 ? "+" : ""}${cumKse.toFixed(1)}%` : "—"} tone="muted" />
            <Stat
              label="Relative"
              value={cumYou != null && cumKse != null ? `${cumYou - cumKse >= 0 ? "+" : ""}${(cumYou - cumKse).toFixed(1)} pp` : "—"}
              tone={cumYou != null && cumKse != null && cumYou >= cumKse ? "positive" : "negative"}
            />
            <Stat label="Max drawdown (with divs)" value={drawdown != null ? `${drawdown.toFixed(1)}%` : "—"} tone="muted" hint={cumTR != null ? `total return ${cumTR >= 0 ? "+" : ""}${cumTR.toFixed(1)}%` : undefined} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-t border-b border-ink text-left">
                  <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium">Month</th>
                  <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium text-right">You (price)</th>
                  <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium text-right">KSE-100</th>
                  <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium text-right">vs KSE</th>
                  <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium text-right">S&amp;P 500</th>
                  <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium text-right">NASDAQ 100</th>
                  <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium text-right">FTSE 100</th>
                  <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium text-right">You (with divs)</th>
                </tr>
              </thead>
              <tbody>
                {monthly.map((m) => {
                  const cell = (v: number | null, signed = true) =>
                    v == null ? <span className="text-muted">—</span> : <span style={signed ? { color: v >= 0 ? "var(--positive)" : "var(--negative)" } : undefined}>{v >= 0 ? "+" : ""}{v.toFixed(1)}%</span>;
                  return (
                    <tr key={m.month} className="border-b border-rule">
                      <td className="px-2 py-1.5 font-mono">{m.month}</td>
                      <td className="px-2 py-1.5 text-right font-mono mono-num">{cell(m.you)}</td>
                      <td className="px-2 py-1.5 text-right font-mono mono-num">{cell(m.kse)}</td>
                      <td className="px-2 py-1.5 text-right font-mono mono-num">{m.rel == null ? <span className="text-muted">—</span> : <span style={{ color: m.rel >= 0 ? "var(--positive)" : "var(--negative)" }}>{m.rel >= 0 ? "+" : ""}{m.rel.toFixed(1)} pp</span>}</td>
                      <td className="px-2 py-1.5 text-right font-mono mono-num">{cell(m.sp500)}</td>
                      <td className="px-2 py-1.5 text-right font-mono mono-num">{cell(m.ndx100)}</td>
                      <td className="px-2 py-1.5 text-right font-mono mono-num">{cell(m.ftse100)}</td>
                      <td className="px-2 py-1.5 text-right font-mono mono-num">{cell(m.youTR)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted mt-2">Partial first and current months are shown as-is. Last 12 month-ends from the daily series.</p>

          <div className="mt-6">
            <div className="label-cap mb-2">The world, same window</div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px] max-w-[560px]">
                <thead>
                  <tr className="border-t border-b border-ink text-left">
                    <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium">Index</th>
                    <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium">Currency</th>
                    <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium text-right">Window return</th>
                    <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium text-right">You vs it</th>
                  </tr>
                </thead>
                <tbody>
                  {worldRows.map((w) => {
                    const youPct = cumYou != null ? cumYou * 100 : null;
                    const gap = w.ret != null && youPct != null ? youPct - w.ret : null;
                    return (
                      <tr key={w.key} className="border-b border-rule">
                        <td className="px-2 py-1.5">{w.label}</td>
                        <td className="px-2 py-1.5 font-mono text-[11px] text-muted">{w.ccy}</td>
                        <td className="px-2 py-1.5 text-right font-mono mono-num">
                          {w.ret == null ? <span className="text-muted">— feed unavailable</span> : <span style={{ color: w.ret >= 0 ? "var(--positive)" : "var(--negative)" }}>{w.ret >= 0 ? "+" : ""}{w.ret.toFixed(1)}%</span>}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono mono-num">
                          {gap == null ? <span className="text-muted">—</span> : <span style={{ color: gap >= 0 ? "var(--positive)" : "var(--negative)" }}>{gap >= 0 ? "+" : ""}{gap.toFixed(1)} pp</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted mt-2 max-w-[72ch]">
              Each index is in its own currency, so this compares stock-picking skill, not currencies. For what a Pakistani investor would have
              REALISED in the foreign ones, add the rupee&apos;s move{usdPkrMove != null ? ` — USD/PKR ${usdPkrMove >= 0 ? "rose" : "fell"} ${Math.abs(usdPkrMove).toFixed(1)}% over this window, which a USD asset would have added on top` : ""}.
            </p>
          </div>
        </Section>
      )}

      <p className="text-[11px] text-muted font-mono mt-8">
        Values are current (not as-of 30 June). For a precise year-end statement, snapshot this page on 30 June.
        Brokerage cash is not counted: the balance is derived from a deposit ledger that was never completed, so it
        would be a figure nobody measured. Add it by hand if you are declaring one.
      </p>
    </div>
  );
}
