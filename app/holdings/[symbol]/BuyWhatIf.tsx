"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { NumberInput } from "@/components/ui/NumberInput";
import { fmtRs, fmtNum, fmtPct } from "@/lib/format";
import { computePSXFees } from "@/lib/calculations/fees";

type Props = {
  symbol: string;
  shares: number; // current shares
  totalCost: number; // current cost basis (incl. past fees)
  currentPrice: number;
  marketValue: number;
  portfolioValue: number; // total equity value today
  concentrationCap: number; // % single-stock cap from Settings
};

// The mirror of the sell-side CGT preview: what a BUY does to your average
// cost, your weight, and what it really costs with brokerage. Pure arithmetic
// on numbers already on this page — nothing is fetched or stored.
export function BuyWhatIf({ symbol, shares, totalCost, currentPrice, marketValue, portfolioValue, concentrationCap }: Props) {
  const [qty, setQty] = useState(0);
  const [price, setPrice] = useState(currentPrice > 0 ? Number(currentPrice.toFixed(2)) : 0);

  const r = useMemo(() => {
    if (qty <= 0 || price <= 0) return null;
    const gross = qty * price;
    const fees = computePSXFees({ shares: qty, price, type: "BUY" });
    const outlay = gross + fees.fee;
    const newShares = shares + qty;
    const newCost = totalCost + outlay;
    const newAvg = newShares > 0 ? newCost / newShares : 0;
    const oldAvg = shares > 0 ? totalCost / shares : 0;
    // Weight after the buy: your position grows by the shares' value; the
    // portfolio grows by the cash you brought in (assumed new money).
    const newValue = marketValue + gross;
    const newPortfolio = portfolioValue + gross;
    const newWeightPct = newPortfolio > 0 ? (newValue / newPortfolio) * 100 : 0;
    return { gross, fees, outlay, newShares, newCost, newAvg, oldAvg, newWeightPct };
  }, [qty, price, shares, totalCost, marketValue, portfolioValue]);

  const overCap = r != null && concentrationCap > 0 && r.newWeightPct > concentrationCap;

  return (
    <Card>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 max-w-[560px]">
        <NumberInput label={`Shares to buy`} value={qty} onChange={setQty} min={0} step={1} />
        <NumberInput label="At price (Rs)" value={price} onChange={setPrice} min={0} step={0.01} hint={currentPrice > 0 ? `Live: ${fmtRs(currentPrice, true)}` : undefined} />
      </div>

      {r && (
        <div className="mt-5 pt-4 border-t border-rule">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="label-cap">Cash needed</div>
              <div className="font-mono mono-num text-[16px]">{fmtRs(r.outlay)}</div>
              <div className="text-[10px] text-muted">incl. {fmtRs(r.fees.fee)} brokerage ({r.fees.rule === "percent" ? "0.20%" : "3 paisa/share"})</div>
            </div>
            <div>
              <div className="label-cap">Avg cost</div>
              <div className="font-mono mono-num text-[16px]">
                {fmtRs(r.oldAvg, true)} → <span className="font-medium">{fmtRs(r.newAvg, true)}</span>
              </div>
              <div className="text-[10px] text-muted">{r.newAvg > r.oldAvg ? "averaging up" : r.newAvg < r.oldAvg ? "averaging down" : "unchanged"}</div>
            </div>
            <div>
              <div className="label-cap">Position</div>
              <div className="font-mono mono-num text-[16px]">{fmtNum(r.newShares)} sh</div>
              <div className="text-[10px] text-muted">cost basis {fmtRs(r.newCost)}</div>
            </div>
            <div>
              <div className="label-cap">Weight</div>
              <div className="font-mono mono-num text-[16px]" style={{ color: overCap ? "var(--negative)" : undefined }}>
                {fmtPct(r.newWeightPct / 100, 1)}
              </div>
              <div className="text-[10px]" style={{ color: overCap ? "var(--negative)" : "var(--muted)" }}>
                {overCap ? `over your ${concentrationCap}% cap` : `cap ${concentrationCap}%`}
              </div>
            </div>
          </div>
          {overCap && (
            <p className="text-[12px] mt-3" style={{ color: "var(--negative)" }}>
              This buy would push {symbol} past the single-stock cap you set in Settings — deliberate concentration or a
              rebalance signal, your call.
            </p>
          )}
        </div>
      )}
      <p className="text-[11px] text-muted mt-4">
        Assumes the cash is NEW money (portfolio grows by the buy). Brokerage: max(0.20%, 3 paisa/share) — the same rule
        used when recording real transactions. Nothing here is saved.
      </p>
    </Card>
  );
}
