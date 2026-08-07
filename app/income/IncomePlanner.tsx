"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Section } from "@/components/layout/Section";
import { Stat, StatRow } from "@/components/ui/Stat";
import { NumberInput } from "@/components/ui/NumberInput";
import { Table, type Column } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { fmtRs, fmtCompact, fmtPct } from "@/lib/format";
import {
  computeWithdrawal,
  portfolioForIncome,
  simulateDepletion,
  milestoneTable,
} from "@/lib/calculations/withdrawal";

type Props = {
  equityValue: number;
  totalNetWorth: number;
  actualReturnPct: number | null;
  reliableReturn: boolean;
  defaultReturnPct: number;
  defaultTarget: number;
  defaultInflationPct: number;
  inflationIsLive: boolean;
  forecastDividends12m: number;
};

export function IncomePlanner({ equityValue, totalNetWorth, actualReturnPct, reliableReturn, defaultReturnPct, defaultTarget, forecastDividends12m, defaultInflationPct, inflationIsLive }: Props) {
  const [base, setBase] = useState<"networth" | "equity">("networth");
  const startPortfolio = base === "networth" ? totalNetWorth : equityValue;

  const [portfolio, setPortfolio] = useState(Math.round(startPortfolio) || 1_000_000);
  const [ret, setRet] = useState(defaultReturnPct);
  // Live PBS CPI by default (was a hardcoded 10) — still user-adjustable.
  const [inflation, setInflation] = useState(defaultInflationPct);
  const [safeRate, setSafeRate] = useState(3);
  const [target, setTarget] = useState(defaultTarget || 200_000);
  const [incomeGrowth, setIncomeGrowth] = useState(10);

  const w = useMemo(
    () => computeWithdrawal({ portfolio, nominalReturnPct: ret, inflationPct: inflation, safeRealRatePct: safeRate }),
    [portfolio, ret, inflation, safeRate]
  );
  const needed = useMemo(() => portfolioForIncome(target, safeRate), [target, safeRate]);
  const sim = useMemo(
    () => simulateDepletion({ portfolio, nominalReturnPct: ret, incomeMonthly: target, incomeGrowthPct: incomeGrowth, years: 50 }),
    [portfolio, ret, target, incomeGrowth]
  );
  const table = useMemo(() => milestoneTable(ret, safeRate), [ret, safeRate]);

  const divMonthly = forecastDividends12m / 12;
  const coverage = target > 0 ? (divMonthly / target) * 100 : 0;
  const lastsForever = incomeGrowth <= w.realReturnPct + 1e-9 || sim.runDryYear == null;

  const setPortfolioToBase = (b: "networth" | "equity") => {
    setBase(b);
    setPortfolio(Math.round(b === "networth" ? totalNetWorth : equityValue) || portfolio);
  };

  const simRows = sim.series.filter((r) => [1, 5, 10, 15, 20, 25, 30, 40, 50].includes(r.year));
  const simCols: Column<(typeof simRows)[number]>[] = [
    { key: "year", header: "Year", mono: true, render: (r) => String(r.year) },
    { key: "wd", header: "Withdraw / yr", align: "right", mono: true, render: (r) => fmtCompact(r.withdrawal) },
    { key: "end", header: "Portfolio end", align: "right", mono: true, render: (r) => <span style={{ color: r.endValue <= 0 ? "var(--negative)" : undefined }}>{r.endValue <= 0 ? "depleted" : fmtCompact(r.endValue)}</span> },
  ];

  const milestoneCols: Column<(typeof table)[number]>[] = [
    { key: "p", header: "Portfolio", mono: true, render: (r) => fmtCompact(r.portfolio) },
    { key: "safe", header: `Safe (${safeRate}% real) / mo`, align: "right", mono: true, render: (r) => <span style={{ color: "var(--positive)" }}>{fmtRs(r.safeMonthly)}</span> },
    { key: "max", header: "Max (spend all profit) / mo", align: "right", mono: true, render: (r) => <span className="text-muted">{fmtRs(r.maxMonthly)}</span> },
  ];

  return (
    <>
      <StatRow>
        <Stat label="Safe income / mo" value={fmtRs(w.safeMonthly)} tone="positive" size="lg" hint={`${safeRate}% real — lasts, rises with inflation`} />
        <Stat label="Max income / mo" value={fmtRs(w.maxMonthly)} tone="muted" hint="spends all profit — capital erodes" />
        <Stat label="Real return" value={fmtPct(w.realReturnPct / 100, 1)} tone={w.realReturnPct >= 0 ? "default" : "negative"} hint={`${ret}% return − ${inflation}% inflation`} />
        <Stat label="Per +1 lakh" value={`+${fmtRs(w.perLakhSafe)}`} tone="muted" hint={`safe · +${fmtRs(w.perLakhMax)} max`} />
        <Stat
          label="Your actual return"
          value={actualReturnPct != null ? fmtPct(actualReturnPct / 100, 1) : "—"}
          tone="accent"
          hint={reliableReturn ? "money-weighted (XIRR) — used" : actualReturnPct != null ? "short history — using 13% instead" : "need more history"}
        />
      </StatRow>

      <Section number="01" title="Your numbers" display="Tune the assumptions." description="Defaults use your actual return and a Pakistan-realistic 3% safe rate and 10% inflation. Change anything.">
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <span className="label-cap">Base on</span>
            <button onClick={() => setPortfolioToBase("networth")} className="label-cap" style={{ color: base === "networth" ? "var(--accent-deep)" : "var(--muted)" }}>Net worth ({fmtCompact(totalNetWorth)})</button>
            <span className="text-muted">·</span>
            <button onClick={() => setPortfolioToBase("equity")} className="label-cap" style={{ color: base === "equity" ? "var(--accent-deep)" : "var(--muted)" }}>PSX equity ({fmtCompact(equityValue)})</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-5">
            <NumberInput label="Portfolio value (Rs)" value={portfolio} onChange={setPortfolio} min={0} step={100000} />
            <NumberInput label="Expected return (%/yr)" value={ret} onChange={setRet} min={0} max={100} step={0.5} suffix="%" hint={reliableReturn ? `your XIRR ${actualReturnPct!.toFixed(1)}%` : `13% PSX long-run (your XIRR ${actualReturnPct != null ? actualReturnPct.toFixed(0) + "%" : "n/a"} needs ≥1y history)`} />
            <NumberInput label="Inflation (%/yr)" value={inflation} onChange={setInflation} min={0} max={60} step={0.5} suffix="%" />
            <NumberInput label="Safe withdrawal rate (% real)" value={safeRate} onChange={setSafeRate} min={0} max={15} step={0.25} suffix="%" hint="3% is the Pakistan-honest number" />
            <NumberInput label="Target income (Rs/mo)" value={target} onChange={setTarget} min={0} step={10000} />
            <NumberInput label="Income growth (%/yr)" value={incomeGrowth} onChange={setIncomeGrowth} min={0} max={50} step={1} suffix="%" hint="grow withdrawals this fast each year" />
          </div>
        </Card>
      </Section>

      <Section number="02" title="To hit your target" display="Reverse the math." description="The portfolio you need to draw your target income safely, and how far today's dividends already get you.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <div className="label-cap mb-1">Portfolio needed for {fmtRs(target)}/mo</div>
            <div className="font-display mono-num text-[30px]" style={{ color: "var(--accent-deep)" }}>{fmtCompact(needed)}</div>
            <p className="text-[12px] text-muted mt-2">At {safeRate}% real. You have {fmtCompact(portfolio)} ({fmtPct(needed > 0 ? portfolio / needed : 0, 0)} of the way).</p>
          </Card>
          <Card>
            <div className="label-cap mb-1">Passive-income coverage</div>
            <div className="font-display mono-num text-[30px]" style={{ color: coverage >= 100 ? "var(--positive)" : "var(--ink)" }}>{coverage.toFixed(0)}%</div>
            <p className="text-[12px] text-muted mt-2">Forecast dividends {fmtRs(divMonthly)}/mo vs your {fmtRs(target)}/mo target. Living on dividends alone never touches principal.</p>
          </Card>
        </div>
      </Section>

      <Section number="03" title="Will it last?" display="The depletion test." description="Draw your target income, grow it by your income-growth rate each year, compound the rest at your return. If income grows faster than the portfolio earns, it eventually runs dry — no starting size fixes that.">
        <Card>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-5">
            <Stat label="Verdict" value={lastsForever ? "Lasts" : `Runs dry yr ${sim.runDryYear}`} tone={lastsForever ? "positive" : "negative"} />
            <Stat label="Peaks at" value={sim.peakYear > 0 ? fmtCompact(sim.peakValue) : fmtCompact(portfolio)} hint={sim.peakYear > 0 ? `year ${sim.peakYear}` : "now"} />
            <Stat label="Income in 10 yrs" value={fmtRs(target * Math.pow(1 + incomeGrowth / 100, 10))} tone="muted" hint={`${incomeGrowth}%/yr growth`} />
          </div>
          {!lastsForever && (
            <p className="text-[12px] mb-4" style={{ color: "var(--negative)" }}>
              Income growing at {incomeGrowth}% outruns a {ret}% portfolio. To last forever, keep income growth at or below your real
              return ({w.realReturnPct.toFixed(1)}%) — i.e. near inflation, not above it.
            </p>
          )}
          <Table columns={simCols} rows={simRows} rowKey={(r) => String(r.year)} empty="—" />
        </Card>
      </Section>

      <Section number="04" title="Income by portfolio size" display="Every lakh counts." description="Monthly income at each portfolio size — the safe rate that lasts vs spending all profit (which erodes in real terms).">
        <Table columns={milestoneCols} rows={table} rowKey={(r) => String(r.portfolio)} empty="—" />
        <p className="text-[11px] text-muted mt-3 max-w-[80ch]">
          Max spends the full nominal return, but with {inflation}% inflation only {w.realReturnPct.toFixed(1)}% is real — so the
          capital and the income lose purchasing power over time. The safe column holds its value. This is math, not financial advice.
        </p>
      </Section>
    </>
  );
}
