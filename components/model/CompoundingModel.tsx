"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Slider } from "@/components/ui/Slider";
import { Toggle } from "@/components/ui/Toggle";
import { OutcomeCard } from "@/components/ui/OutcomeCard";
import { Table, type Column } from "@/components/ui/Table";
import { ProjectionChart, type ProjectionPoint } from "@/components/charts/ProjectionChart";
import { project, SCENARIO_PRESETS, type ProjectionRow } from "@/lib/calculations";
import {
  fmtRs,
  fmtNum,
  fmtPct,
  fmtSignedPct,
  fmtCompact,
  fmtMultiple,
} from "@/lib/format";

type Props = {
  initialShares: number;
  currentPrice: number;
  symbol?: string;
  totalCost?: number;
};

export function CompoundingModel({ initialShares, currentPrice, symbol, totalCost }: Props) {
  const [preset, setPreset] = useState<string>("status-quo");
  const [annualGrowth, setAnnualGrowth] = useState(0.10);
  const [peStart, setPeStart] = useState(8);
  const [peEnd, setPeEnd] = useState(8);
  const [payoutRatio, setPayoutRatio] = useState(0.40);
  const [horizonYears, setHorizonYears] = useState(20);
  const [useDRIP, setUseDRIP] = useState(true);
  const [showTable, setShowTable] = useState(false);

  function applyPreset(id: string) {
    const p = SCENARIO_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setPreset(id);
    if (id === "custom") return;
    setAnnualGrowth(p.annualGrowth);
    setPeEnd(p.peEnd);
    setPayoutRatio(p.payoutRatio);
  }

  const result = useMemo(
    () =>
      project({
        initialShares,
        currentPrice,
        peStart,
        peEnd,
        annualGrowth,
        payoutRatio,
        horizonYears,
        useDRIP,
      }),
    [initialShares, currentPrice, peStart, peEnd, annualGrowth, payoutRatio, horizonYears, useDRIP]
  );

  const resultNoDrip = useMemo(
    () =>
      project({
        initialShares,
        currentPrice,
        peStart,
        peEnd,
        annualGrowth,
        payoutRatio,
        horizonYears,
        useDRIP: false,
      }),
    [initialShares, currentPrice, peStart, peEnd, annualGrowth, payoutRatio, horizonYears]
  );

  const chartData: ProjectionPoint[] = useMemo(() => {
    return result.rows.map((row, i) => {
      const noDripRow = resultNoDrip.rows[i];
      return {
        year: row.year,
        withDrip: row.value + row.divsCumulative,
        withoutDrip: noDripRow.value + noDripRow.divsCumulative,
        priceOnly: row.shares * row.price,
      };
    });
  }, [result, resultNoDrip]);

  function findHorizon(years: number): ProjectionRow {
    return result.rows.find((r) => r.year === years) ?? result.rows[result.rows.length - 1];
  }

  function outcomeForHorizon(years: number) {
    const row = findHorizon(years);
    const endValue = row.value + row.divsCumulative;
    const multiple = result.startValue > 0 ? endValue / result.startValue : 0;
    const cagr =
      result.startValue > 0 && years > 0
        ? Math.pow(endValue / result.startValue, 1 / years) - 1
        : 0;
    return { endValue, multiple, cagr };
  }

  const outcome5 = outcomeForHorizon(Math.min(5, horizonYears));
  const outcome10 = outcomeForHorizon(Math.min(10, horizonYears));
  const outcome15 = outcomeForHorizon(Math.min(horizonYears, 15));

  const tableColumns: Column<ProjectionRow>[] = [
    { key: "year", header: "Year", mono: true, render: (r) => `Y${r.year}` },
    { key: "eps", header: "EPS", align: "right", mono: true, render: (r) => fmtRs(r.eps, true) },
    { key: "pe", header: "P/E", align: "right", mono: true, render: (r) => r.pe.toFixed(2) },
    { key: "price", header: "Price", align: "right", mono: true, render: (r) => fmtRs(r.price, true) },
    { key: "shares", header: "Shares", align: "right", mono: true, render: (r) => fmtNum(r.shares) },
    {
      key: "div",
      header: "Div/Share",
      align: "right",
      mono: true,
      render: (r) => fmtRs(r.dividendPerShare, true),
    },
    { key: "value", header: "Value", align: "right", mono: true, render: (r) => fmtCompact(r.value) },
    {
      key: "totalValue",
      header: "Total Value",
      align: "right",
      mono: true,
      render: (r) => fmtCompact(r.value + r.divsCumulative),
    },
  ];

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {SCENARIO_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => applyPreset(p.id)}
            className="text-left p-4 border transition-colors"
            style={{
              borderColor: preset === p.id ? "var(--ink)" : "var(--rule)",
              background: preset === p.id ? "var(--paper-2)" : "transparent",
              borderLeft: preset === p.id ? "4px solid var(--accent)" : "1px solid var(--rule)",
            }}
          >
            <div className="label-cap mb-1">{p.label}</div>
            <p className="text-[11px] text-muted leading-snug">{p.description}</p>
          </button>
        ))}
      </div>

      <Card>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-5">
          <Slider
            label="Annual EPS growth"
            value={Math.round(annualGrowth * 1000)}
            min={0}
            max={300}
            step={5}
            onChange={(v) => {
              setAnnualGrowth(v / 1000);
              setPreset("custom");
            }}
            format={(v) => fmtSignedPct(v / 1000, 1)}
            hint="Long-term EPS growth rate per year."
          />
          <Slider
            label="Starting P/E"
            value={peStart}
            min={3}
            max={30}
            step={0.5}
            onChange={(v) => {
              setPeStart(v);
              setPreset("custom");
            }}
            format={(v) => `${v.toFixed(1)}×`}
            hint="Today's implied P/E (price / EPS)."
          />
          <Slider
            label="Ending P/E"
            value={peEnd}
            min={3}
            max={30}
            step={0.5}
            onChange={(v) => {
              setPeEnd(v);
              setPreset("custom");
            }}
            format={(v) => `${v.toFixed(1)}×`}
            hint="P/E at the end of the horizon (linear path)."
          />
          <Slider
            label="Dividend payout ratio"
            value={Math.round(payoutRatio * 100)}
            min={0}
            max={100}
            step={5}
            onChange={(v) => {
              setPayoutRatio(v / 100);
              setPreset("custom");
            }}
            format={(v) => `${v}%`}
            hint="Share of EPS paid out as dividends."
          />
          <Slider
            label="Horizon"
            value={horizonYears}
            min={5}
            max={25}
            step={5}
            onChange={(v) => setHorizonYears(v)}
            format={(v) => `${v} yrs`}
            hint="How many years to compound forward."
          />
          <Toggle
            label="Reinvest dividends (DRIP)"
            value={useDRIP}
            onChange={setUseDRIP}
            hint="Reinvest at the year-end price."
          />
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <OutcomeCard
          horizon={`${Math.min(5, horizonYears)}-year`}
          multiple={fmtMultiple(outcome5.multiple)}
          value={fmtCompact(outcome5.endValue)}
          cagr={fmtSignedPct(outcome5.cagr, 1)}
        />
        <OutcomeCard
          horizon={`${Math.min(10, horizonYears)}-year`}
          multiple={fmtMultiple(outcome10.multiple)}
          value={fmtCompact(outcome10.endValue)}
          cagr={fmtSignedPct(outcome10.cagr, 1)}
          emphasis
        />
        <OutcomeCard
          horizon={`${Math.min(15, horizonYears)}-year`}
          multiple={fmtMultiple(outcome15.multiple)}
          value={fmtCompact(outcome15.endValue)}
          cagr={fmtSignedPct(outcome15.cagr, 1)}
        />
      </div>

      <ProjectionChart data={chartData} startValue={result.startValue} />

      <div className="flex items-center justify-between">
        <div className="label-cap">Year-by-year detail</div>
        <Button variant="outline" onClick={() => setShowTable(!showTable)}>
          {showTable ? "Hide" : "Show"}
        </Button>
      </div>
      {showTable && (
        <Table
          columns={tableColumns}
          rows={result.rows}
          rowKey={(r) => String(r.year)}
        />
      )}

      {totalCost !== undefined && totalCost > 0 && (
        <Card>
          <div className="label-cap mb-2">Sizing reference</div>
          <p className="text-sm leading-relaxed">
            You&apos;ve invested <span className="font-mono mono-num">{fmtRs(totalCost)}</span> in {symbol ?? "this position"}.
            At the modelled horizon ({horizonYears}Y, {fmtPct(annualGrowth, 0)} growth, ending P/E{" "}
            {peEnd.toFixed(1)}×), this becomes{" "}
            <span className="font-mono mono-num font-medium">{fmtCompact(outcome15.endValue)}</span> —
            a <span className="font-mono mono-num">{fmtMultiple(outcome15.multiple)}</span> multiple at{" "}
            <span className="font-mono mono-num">{fmtSignedPct(outcome15.cagr, 1)}</span> CAGR.
          </p>
        </Card>
      )}
    </div>
  );
}
