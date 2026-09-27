"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { NumberInput } from "@/components/ui/NumberInput";
import { Toggle } from "@/components/ui/Toggle";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { fmtRs, fmtNum, fmtPct, fmtSignedRs } from "@/lib/format";
import { computeRebalance, type RebalanceSuggestion } from "@/lib/calculations";
import type { PositionRow } from "@/lib/calculations";

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
  const [redistribute, setRedistribute] = useState(true);
  const [orderPrices, setOrderPrices] = useState<Record<string, number | "">>({});

  const cashFromBalance = useBalance ? Math.min(balanceToUse, availableCashBalance) : 0;

  const result = useMemo(
    () =>
      computeRebalance({
        positions,
        freshCash,
        cashFromBalance,
        totalValue,
        allowSelling,
        orderPrices,
        redistribute,
      }),
    [positions, freshCash, cashFromBalance, totalValue, allowSelling, orderPrices, redistribute]
  );

  const { rows, cashIn, deployed, cashAfter, leftoverDeployed, warnings } = result;

  function setOrder(symbol: string, v: number | "") {
    setOrderPrices((prev) => ({ ...prev, [symbol]: v }));
  }
  function resetOrders() {
    setOrderPrices({});
  }
  const hasCustomPrices = Object.values(orderPrices).some((v) => typeof v === "number" && v > 0);

  return (
    <div className="space-y-6">
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
          <NumberInput
            label="Fresh cash to add (Rs)"
            value={freshCash}
            onChange={setFreshCash}
            step={1}
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
                setBalanceToUse(v ? Math.max(0, availableCashBalance) : 0);
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
                step={1}
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
          <Toggle
            label="Deploy leftover cash (greedy)"
            value={redistribute}
            onChange={setRedistribute}
            hint="Spend rounding leftover on the most-underweight positions until it can't buy another share."
          />
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <SummaryStat label="Cash in" value={fmtRs(cashIn)} />
          <SummaryStat label="Deployed" value={fmtRs(deployed)} />
          <SummaryStat label="Greedy leftover used" value={fmtRs(leftoverDeployed)} />
          <SummaryStat label="Cash remaining" value={fmtRs(cashAfter)} />
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <div className="label-cap">Per-holding plan</div>
        {hasCustomPrices && (
          <Button variant="outline" onClick={resetOrders}>
            Reset order prices
          </Button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-t border-ink border-b border-ink">
              {["Symbol", "Now → Target → Final", "Mkt", "Order Price", "Action", "Change", "Shares"].map(
                (h, i) => (
                  <th
                    key={h}
                    className="px-3 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium"
                    style={{ textAlign: i <= 1 ? "left" : "right" }}
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted text-sm">
                  No positions yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const customized =
                  typeof orderPrices[r.symbol] === "number" && (orderPrices[r.symbol] as number) > 0;
                return (
                  <tr key={r.symbol} className="border-b border-rule">
                    <td className="px-3 py-2.5 font-mono font-medium">{r.symbol}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5 font-mono mono-num text-[12px]">
                        <span>{fmtPct(r.currentPct / 100, 1)}</span>
                        <span className="text-muted">→</span>
                        <span className="text-muted">{fmtPct(r.targetPct / 100, 0)}</span>
                        <span className="text-muted">→</span>
                        <span style={{ color: "var(--accent-deep)" }}>{fmtPct(r.finalPct / 100, 1)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono mono-num text-muted">
                      {fmtRs(r.livePrice, true)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="inline-flex items-center border-b border-ink">
                        <input
                          type="number"
                          value={orderPrices[r.symbol] ?? ""}
                          placeholder={r.livePrice ? r.livePrice.toFixed(2) : "0"}
                          onChange={(e) =>
                            setOrder(r.symbol, e.target.value === "" ? "" : Number(e.target.value))
                          }
                          step={0.01}
                          min={0}
                          className="w-20 bg-transparent text-right font-mono mono-num text-[13px] py-1 focus:outline-none"
                          style={{ color: customized ? "var(--accent-deep)" : "var(--ink)" }}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Badge
                        tone={r.action === "BUY" ? "accent" : r.action === "SELL" ? "negative" : "default"}
                      >
                        {r.action === "WIND_DOWN" ? "WIND DOWN" : r.action}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono mono-num">
                      {r.action === "HOLD" || r.action === "WIND_DOWN" ? (
                        "—"
                      ) : (
                        <span style={{ color: r.action === "BUY" ? "var(--positive)" : "var(--negative)" }}>
                          {fmtSignedRs(r.actionRupees)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono mono-num">
                      {r.deltaShares === 0
                        ? "—"
                        : `${r.deltaShares > 0 ? "+" : ""}${fmtNum(r.deltaShares)}`}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted font-mono">
        Order price defaults to the live quote. Override it (e.g. a lower limit price) and shares are
        computed at your price. With greedy deployment on, leftover cash buys whole shares of the
        most-underweight holdings until under the cheapest share price.
      </p>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] tracking-stat uppercase font-mono" style={{ color: "rgba(245,241,232,0.65)" }}>
        {label}
      </div>
      <div className="font-display mono-num text-[22px]">
        {value}
      </div>
    </div>
  );
}
