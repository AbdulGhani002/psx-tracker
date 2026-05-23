"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { NumberInput } from "@/components/ui/NumberInput";
import { Toggle } from "@/components/ui/Toggle";
import { Table, type Column } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { fmtRs, fmtNum, fmtPct, fmtSignedRs, fmtSignedPct } from "@/lib/format";
import type { PositionRow } from "@/lib/calculations";

type Suggestion = {
  symbol: string;
  sector: string;
  currentValue: number;
  targetValue: number;
  currentPct: number;
  targetPct: number;
  deltaRs: number;
  deltaShares: number;
  action: "BUY" | "SELL" | "HOLD";
  currentPrice: number;
};

function computeSuggestions(
  positions: PositionRow[],
  cash: number,
  totalValue: number,
  allowSelling: boolean
): { rows: Suggestion[]; cashAfter: number; deployed: number; warnings: string[] } {
  const targetTotal = totalValue + Math.max(0, cash);

  const rows: Suggestion[] = positions.map((p) => {
    const targetValue = (p.targetPercent / 100) * targetTotal;
    let deltaRs = targetValue - p.marketValue;
    if (!allowSelling && deltaRs < 0) deltaRs = 0;
    const deltaShares = p.currentPrice > 0 ? Math.floor(Math.abs(deltaRs) / p.currentPrice) * Math.sign(deltaRs) : 0;
    const action: Suggestion["action"] = deltaRs > 0 ? "BUY" : deltaRs < 0 ? "SELL" : "HOLD";
    return {
      symbol: p.symbol,
      sector: p.sector,
      currentValue: p.marketValue,
      targetValue,
      currentPct: p.currentPercent,
      targetPct: p.targetPercent,
      deltaRs,
      deltaShares,
      action,
      currentPrice: p.currentPrice,
    };
  });

  // Cap buy spend to not exceed cash
  const totalBuy = rows.filter((r) => r.action === "BUY").reduce((s, r) => s + r.deltaRs, 0);
  const totalSell = rows.filter((r) => r.action === "SELL").reduce((s, r) => s + Math.abs(r.deltaRs), 0);
  const availableForBuy = cash + (allowSelling ? totalSell : 0);
  const scale = totalBuy > availableForBuy && totalBuy > 0 ? availableForBuy / totalBuy : 1;
  if (scale < 1) {
    for (const r of rows) {
      if (r.action === "BUY") {
        r.deltaRs = r.deltaRs * scale;
        r.deltaShares = r.currentPrice > 0 ? Math.floor(r.deltaRs / r.currentPrice) : 0;
      }
    }
  }

  const deployed = rows.reduce((s, r) => s + (r.action === "BUY" ? r.deltaRs : 0), 0);
  const released = rows.reduce((s, r) => s + (r.action === "SELL" ? Math.abs(r.deltaRs) : 0), 0);
  const cashAfter = cash + released - deployed;

  const warnings: string[] = [];
  for (const r of rows) {
    const newPct = totalValue + cash > 0 ? ((r.currentValue + r.deltaRs) / (totalValue + cash)) * 100 : 0;
    if (newPct > 25) {
      warnings.push(`${r.symbol} would exceed 25% concentration (${newPct.toFixed(1)}%).`);
    }
  }

  return { rows, cashAfter, deployed, warnings };
}

type Props = {
  positions: PositionRow[];
  totalValue: number;
};

export function RebalanceView({ positions, totalValue }: Props) {
  const [cash, setCash] = useState<number>(100000);
  const [allowSelling, setAllowSelling] = useState(false);

  const { rows, cashAfter, deployed, warnings } = useMemo(
    () => computeSuggestions(positions, cash, totalValue, allowSelling),
    [positions, cash, totalValue, allowSelling]
  );

  const columns: Column<Suggestion>[] = [
    { key: "symbol", header: "Symbol", render: (r) => <span className="font-mono font-medium">{r.symbol}</span> },
    {
      key: "alloc",
      header: "Allocation",
      align: "right",
      render: (r) => (
        <div className="flex items-center justify-end gap-2 font-mono mono-num text-[12px]">
          <span>{fmtPct(r.currentPct / 100, 1)}</span>
          <span className="text-muted">→</span>
          <span>{fmtPct(r.targetPct / 100, 0)}</span>
        </div>
      ),
    },
    { key: "currentValue", header: "Current", align: "right", mono: true, render: (r) => fmtRs(r.currentValue) },
    { key: "targetValue", header: "Target", align: "right", mono: true, render: (r) => fmtRs(r.targetValue) },
    {
      key: "action",
      header: "Action",
      render: (r) => (
        <Badge tone={r.action === "BUY" ? "accent" : r.action === "SELL" ? "negative" : "default"}>
          {r.action}
        </Badge>
      ),
    },
    {
      key: "delta",
      header: "Change",
      align: "right",
      mono: true,
      render: (r) =>
        r.action === "HOLD" ? (
          "—"
        ) : (
          <span style={{ color: r.action === "BUY" ? "var(--positive)" : "var(--negative)" }}>
            {fmtSignedRs(r.deltaRs)}
          </span>
        ),
    },
    {
      key: "shares",
      header: "Shares",
      align: "right",
      mono: true,
      render: (r) => (r.deltaShares === 0 ? "—" : `${r.deltaShares > 0 ? "+" : ""}${fmtNum(r.deltaShares)}`),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
        <NumberInput
          label="Cash to deploy (Rs)"
          value={cash}
          onChange={setCash}
          step={10000}
          min={0}
          large
        />
        <Toggle
          label="Allow selling overweight positions"
          value={allowSelling}
          onChange={setAllowSelling}
          hint="Disabled = only deploy fresh cash."
        />
        <div>
          <div className="label-cap">After rebalancing</div>
          <div className="font-display mono-num text-[22px] mt-0.5" style={{ fontVariationSettings: "'opsz' 144" }}>
            {fmtRs(cashAfter)}
          </div>
          <div className="text-[11px] text-muted font-mono mt-1">cash remaining</div>
        </div>
      </div>

      {warnings.length > 0 && (
        <Card>
          <div className="section-eyebrow mb-2" style={{ color: "var(--accent-deep)" }}>
            Warnings
          </div>
          <ul className="space-y-1 text-[13px]">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Card>
      )}

      <Card inverted>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <div className="text-[10px] tracking-stat uppercase font-mono" style={{ color: "rgba(245,241,232,0.65)" }}>
              Cash in
            </div>
            <div className="font-display mono-num text-[24px]" style={{ fontVariationSettings: "'opsz' 144" }}>
              {fmtRs(cash)}
            </div>
          </div>
          <div>
            <div className="text-[10px] tracking-stat uppercase font-mono" style={{ color: "rgba(245,241,232,0.65)" }}>
              To be deployed
            </div>
            <div className="font-display mono-num text-[24px]" style={{ fontVariationSettings: "'opsz' 144" }}>
              {fmtRs(deployed)}
            </div>
          </div>
          <div>
            <div className="text-[10px] tracking-stat uppercase font-mono" style={{ color: "rgba(245,241,232,0.65)" }}>
              Cash remaining
            </div>
            <div className="font-display mono-num text-[24px]" style={{ fontVariationSettings: "'opsz' 144" }}>
              {fmtRs(cashAfter)}
            </div>
          </div>
        </div>
      </Card>

      <Table columns={columns} rows={rows} rowKey={(r) => r.symbol} empty="No positions yet." />
    </div>
  );
}
