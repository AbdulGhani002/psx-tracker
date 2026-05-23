"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { NumberInput } from "@/components/ui/NumberInput";
import { Toggle } from "@/components/ui/Toggle";
import { Table, type Column } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { fmtRs, fmtNum, fmtPct, fmtSignedRs } from "@/lib/format";
import type { PositionRow } from "@/lib/calculations";

type Suggestion = {
  symbol: string;
  sector: string;
  currentValue: number;
  targetValue: number;
  currentPct: number;
  targetPct: number;
  actionRupees: number; // signed: + = buy, − = sell, exactly shares × price
  deltaShares: number;
  action: "BUY" | "SELL" | "HOLD";
  currentPrice: number;
  unusedRupees: number; // per-row leftover from share rounding
};

function computeSuggestions(
  positions: PositionRow[],
  freshCash: number,
  cashFromBalance: number,
  totalValue: number,
  allowSelling: boolean
): {
  rows: Suggestion[];
  cashIn: number;
  deployed: number;
  cashAfter: number;
  warnings: string[];
} {
  const cashIn = Math.max(0, freshCash) + Math.max(0, cashFromBalance);
  const targetTotal = totalValue + cashIn;

  const rows: Suggestion[] = positions.map((p) => {
    const targetValue = (p.targetPercent / 100) * targetTotal;
    let deltaRs = targetValue - p.marketValue;
    if (!allowSelling && deltaRs < 0) deltaRs = 0;

    // Convert delta to integer share count (you can't buy half a share).
    let deltaShares = 0;
    let actionRupees = 0;
    if (p.currentPrice > 0 && deltaRs !== 0) {
      if (deltaRs > 0) {
        // BUY: round DOWN so we never exceed budget.
        deltaShares = Math.floor(deltaRs / p.currentPrice);
        actionRupees = deltaShares * p.currentPrice;
      } else {
        // SELL: round UP toward zero (sell at most |deltaRs|/price shares).
        deltaShares = -Math.floor(Math.abs(deltaRs) / p.currentPrice);
        actionRupees = deltaShares * p.currentPrice;
      }
    }

    const action: Suggestion["action"] =
      actionRupees > 0 ? "BUY" : actionRupees < 0 ? "SELL" : "HOLD";

    return {
      symbol: p.symbol,
      sector: p.sector,
      currentValue: p.marketValue,
      targetValue,
      currentPct: p.currentPercent,
      targetPct: p.targetPercent,
      actionRupees,
      deltaShares,
      action,
      currentPrice: p.currentPrice,
      unusedRupees: Math.max(0, deltaRs - Math.max(0, actionRupees)),
    };
  });

  // Cap buy spend so total <= cash + sells. Round each buy DOWN as we scale.
  const totalBuyTarget = rows
    .filter((r) => r.action === "BUY")
    .reduce((s, r) => s + r.actionRupees, 0);
  const totalSell = rows
    .filter((r) => r.action === "SELL")
    .reduce((s, r) => s + Math.abs(r.actionRupees), 0);
  const availableForBuy = cashIn + (allowSelling ? totalSell : 0);

  if (totalBuyTarget > availableForBuy && totalBuyTarget > 0) {
    const scale = availableForBuy / totalBuyTarget;
    for (const r of rows) {
      if (r.action === "BUY" && r.currentPrice > 0) {
        const scaled = r.actionRupees * scale;
        const newShares = Math.floor(scaled / r.currentPrice);
        r.deltaShares = newShares;
        r.actionRupees = newShares * r.currentPrice;
        r.action = newShares > 0 ? "BUY" : "HOLD";
      }
    }
  }

  const deployed = rows.reduce(
    (s, r) => s + (r.action === "BUY" ? r.actionRupees : 0),
    0
  );
  const released = rows.reduce(
    (s, r) => s + (r.action === "SELL" ? Math.abs(r.actionRupees) : 0),
    0
  );
  const cashAfter = cashIn + released - deployed;

  const warnings: string[] = [];
  for (const r of rows) {
    const newValue = r.currentValue + r.actionRupees;
    const newTotal = totalValue + cashIn + released - deployed;
    const newPct = newTotal > 0 ? (newValue / (totalValue + cashIn)) * 100 : 0;
    if (newPct > 25) {
      warnings.push(`${r.symbol} would exceed 25% concentration (${newPct.toFixed(1)}%).`);
    }
  }

  return { rows, cashIn, deployed, cashAfter, warnings };
}

type Props = {
  positions: PositionRow[];
  totalValue: number;
  availableCashBalance: number;
};

export function RebalanceView({ positions, totalValue, availableCashBalance }: Props) {
  const [freshCash, setFreshCash] = useState<number>(0);
  const [useBalance, setUseBalance] = useState<boolean>(availableCashBalance > 0);
  const [balanceToUse, setBalanceToUse] = useState<number>(Math.max(0, availableCashBalance));
  const [allowSelling, setAllowSelling] = useState(false);

  const cashFromBalance = useBalance ? Math.min(balanceToUse, availableCashBalance) : 0;

  const { rows, cashIn, deployed, cashAfter, warnings } = useMemo(
    () =>
      computeSuggestions(
        positions,
        freshCash,
        cashFromBalance,
        totalValue,
        allowSelling
      ),
    [positions, freshCash, cashFromBalance, totalValue, allowSelling]
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
            {fmtSignedRs(r.actionRupees)}
          </span>
        ),
    },
    {
      key: "shares",
      header: "Shares",
      align: "right",
      mono: true,
      render: (r) =>
        r.deltaShares === 0 ? "—" : `${r.deltaShares > 0 ? "+" : ""}${fmtNum(r.deltaShares)}`,
    },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
          <NumberInput
            label="Fresh cash to add (Rs)"
            value={freshCash}
            onChange={setFreshCash}
            step={10000}
            min={0}
            large
            hint="New money you're depositing for this rebalance."
          />
          <div className="space-y-3">
            <Toggle
              label="Also use available cash balance"
              value={useBalance}
              onChange={(v) => {
                setUseBalance(v);
                if (v) setBalanceToUse(Math.max(0, availableCashBalance));
                else setBalanceToUse(0);
              }}
              hint={`Brokerage balance: ${fmtRs(availableCashBalance)}`}
            />
            {useBalance && (
              <NumberInput
                label="From cash balance (Rs)"
                value={balanceToUse}
                onChange={setBalanceToUse}
                min={0}
                max={Math.max(0, availableCashBalance)}
                step={1000}
                hint={`Max ${fmtRs(availableCashBalance)}`}
              />
            )}
          </div>
          <Toggle
            label="Allow selling overweight positions"
            value={allowSelling}
            onChange={setAllowSelling}
            hint="Off = only deploy cash; never sells."
          />
          <div>
            <div className="label-cap">After rebalancing</div>
            <div
              className="font-display mono-num text-[26px] mt-0.5"
              style={{
                fontVariationSettings: "'opsz' 144",
                color: cashAfter > 0 ? "var(--positive)" : "var(--ink)",
              }}
            >
              {fmtRs(cashAfter)}
            </div>
            <div className="text-[11px] text-muted font-mono mt-1">
              cash remaining (rounding leftover)
            </div>
          </div>
        </div>
      </Card>

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
              {fmtRs(cashIn)}
            </div>
          </div>
          <div>
            <div className="text-[10px] tracking-stat uppercase font-mono" style={{ color: "rgba(245,241,232,0.65)" }}>
              Deployed (integer shares)
            </div>
            <div className="font-display mono-num text-[24px]" style={{ fontVariationSettings: "'opsz' 144" }}>
              {fmtRs(deployed)}
            </div>
          </div>
          <div>
            <div className="text-[10px] tracking-stat uppercase font-mono" style={{ color: "rgba(245,241,232,0.65)" }}>
              Leftover (back to cash)
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
