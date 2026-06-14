"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Stat, StatRow } from "@/components/ui/Stat";
import { stressTest } from "@/lib/calculations/risk-analysis";
import { fmtCompact, fmtRs } from "@/lib/format";

type Base = { equity: number; funds: number; savings: number; cash: number };

export function StressTester({ base, safeRatePct }: { base: Base; safeRatePct: number }) {
  const [drop, setDrop] = useState(20);
  const r = useMemo(() => stressTest({ ...base, marketDropPct: drop, safeRatePct }), [base, drop, safeRatePct]);
  const presets = [10, 20, 30, 50];

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <span className="label-cap">Market drop</span>
        {presets.map((p) => (
          <button
            key={p}
            onClick={() => setDrop(p)}
            className="font-mono text-[12px] px-2 py-0.5 border"
            style={{ borderColor: drop === p ? "var(--ink)" : "var(--rule)", color: drop === p ? "var(--ink)" : "var(--muted)" }}
          >
            −{p}%
          </button>
        ))}
        <input type="range" min={0} max={70} step={1} value={drop} onChange={(e) => setDrop(Number(e.target.value))} className="flex-1 min-w-[140px]" />
        <span className="font-mono mono-num text-[14px] w-[48px] text-right">−{drop}%</span>
      </div>
      <StatRow>
        <Stat label="Net worth now" value={fmtCompact(r.baseNetWorth)} />
        <Stat label={`If market −${drop}%`} value={fmtCompact(r.stressedNetWorth)} tone="negative" hint={`−${fmtCompact(r.lossPkr)} (${r.lossPct.toFixed(1)}%)`} />
        <Stat label="Safe income now" value={`${fmtRs(r.safeIncomeBefore)}/mo`} tone="muted" />
        <Stat label="Safe income after" value={`${fmtRs(r.safeIncomeAfter)}/mo`} tone="negative" />
      </StatRow>
      <p className="text-[11px] text-muted mt-3 max-w-[80ch]">
        The drop hits equities and mutual funds (market-linked); savings and cash are held flat. Safe income is the {safeRatePct}% real
        withdrawal on the reduced portfolio. This is a what-if, not a forecast.
      </p>
    </Card>
  );
}
