"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { NumberInput } from "@/components/ui/NumberInput";
import { fmtRs, fmtNum, fmtSignedRs } from "@/lib/format";
import { computePSXFees } from "@/lib/calculations/fees";
import { planKeepPct } from "@/lib/calculations/keep-model";

type Lot = { acquired: string; shares: number; costPerShare: number };

type Props = {
  symbol: string;
  currentPrice: number;
  lots: Lot[]; // open FIFO lots, oldest first
  positionValue: number;
  portfolioValue: number;
  cgtRatePct: number;
  taxYearLabel: string;
  netRiskFreePct: number | null; // best MMF net of WHT
  netRiskFreeLabel: string;
  equityAfterTaxPct: number | null; // this position's after-tax return
};

// Sell-side what-if: FIFO lots consumed oldest-first, the exact CGT this tax
// year, the new weight, and what the freed cash would earn at your real
// alternative vs staying invested. Works in both directions: type the shares
// to sell, or type the percentage of the position you want to KEEP and the
// whole-share sell quantity that lands nearest solves itself. Pure arithmetic
// on data already on the page — nothing is fetched or stored, and nothing
// here places a trade.
export function TrimWhatIf({
  symbol,
  currentPrice,
  lots,
  positionValue,
  portfolioValue,
  cgtRatePct,
  taxYearLabel,
  netRiskFreePct,
  netRiskFreeLabel,
  equityAfterTaxPct,
}: Props) {
  const totalShares = lots.reduce((s, l) => s + l.shares, 0);
  const [qty, setQty] = useState(0);
  const [keepPct, setKeepPct] = useState(100);
  // Whichever box was touched last drives the other one.
  const [driver, setDriver] = useState<"shares" | "keep">("shares");
  const [price, setPrice] = useState(currentPrice > 0 ? Number(currentPrice.toFixed(2)) : 0);

  const plan = driver === "keep" ? planKeepPct(totalShares, keepPct) : null;
  const sellQty = driver === "keep" ? plan?.sellShares ?? 0 : qty;
  const keptShares = Math.max(0, totalShares - sellQty);
  const keptPct = totalShares > 0 ? (keptShares / totalShares) * 100 : 0;

  const r = useMemo(() => {
    if (sellQty <= 0 || price <= 0 || sellQty > totalShares) return null;
    // Consume lots oldest-first — exactly how the CGT report will see it.
    let remaining = sellQty;
    const consumed: Array<Lot & { taken: number; gain: number; longTerm: boolean }> = [];
    const today = new Date();
    for (const lot of lots) {
      if (remaining <= 0) break;
      const taken = Math.min(lot.shares, remaining);
      remaining -= taken;
      const days = Math.round((today.getTime() - new Date(lot.acquired).getTime()) / 86400000);
      consumed.push({ ...lot, taken, gain: (price - lot.costPerShare) * taken, longTerm: days > 365 });
    }
    const proceeds = sellQty * price;
    const fees = computePSXFees({ shares: sellQty, price, type: "SELL" }).fee;
    const netGain = consumed.reduce((s, c) => s + c.gain, 0);
    const cgt = Math.max(0, netGain) * (cgtRatePct / 100);
    const freedCash = proceeds - fees - cgt;
    const newValue = Math.max(0, positionValue - proceeds);
    // Portfolio total is unchanged by a sale (value just changes shape),
    // less the frictions that leave it.
    const newPortfolio = Math.max(1, portfolioValue - fees - cgt);
    const newWeightPct = (newValue / newPortfolio) * 100;
    const mmfPerYear = netRiskFreePct != null ? (freedCash * netRiskFreePct) / 100 : null;
    const stayPerYear = equityAfterTaxPct != null ? (freedCash * equityAfterTaxPct) / 100 : null;
    return { proceeds, fees, netGain, cgt, freedCash, newValue, newWeightPct, consumed, mmfPerYear, stayPerYear };
  }, [sellQty, price, totalShares, lots, positionValue, portfolioValue, cgtRatePct, netRiskFreePct, equityAfterTaxPct]);

  return (
    <Card>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div>
          <div className="label-cap mb-1.5">Shares to sell</div>
          <NumberInput
            value={sellQty}
            onChange={(v) => {
              setQty(v);
              setDriver("shares");
            }}
            min={0}
            max={totalShares}
            step={1}
          />
          <div className="text-[10px] text-muted mt-1">of {fmtNum(totalShares)} held</div>
        </div>
        <div>
          <div className="label-cap mb-1.5">% of position to keep</div>
          <NumberInput
            value={driver === "keep" ? keepPct : Number(keptPct.toFixed(2))}
            onChange={(v) => {
              setKeepPct(v);
              setDriver("keep");
            }}
            min={0}
            max={100}
            step={0.1}
            suffix="%"
          />
          <div className="text-[10px] text-muted mt-1">
            {driver === "keep" && plan
              ? `nearest whole shares: sell ${fmtNum(plan.sellShares)}, keep ${fmtNum(plan.keepShares)}`
              : "type a % — the shares solve themselves"}
          </div>
        </div>
        <div>
          <div className="label-cap mb-1.5">At price</div>
          <NumberInput value={price} onChange={setPrice} min={0} step={0.01} />
        </div>
      </div>

      {sellQty > 0 && sellQty <= totalShares && totalShares > 0 && (
        <div className="mt-3 text-[13px]">
          Sell <span className="font-mono mono-num font-medium">{fmtNum(sellQty)}</span> of {fmtNum(totalShares)} → you keep{" "}
          <span className="font-mono mono-num font-medium">{fmtNum(keptShares)}</span> shares ={" "}
          <span className="font-mono mono-num font-medium">{keptPct.toFixed(2)}%</span> of the position
          {driver === "keep" && plan && Math.abs(plan.targetKeepPct - keptPct) > 0.005 && (
            <span className="text-muted"> (target {plan.targetKeepPct}% — whole shares land here)</span>
          )}
        </div>
      )}

      {r && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4 pt-3 border-t border-rule">
          <div>
            <div className="label-cap mb-1.5">Freed cash (net)</div>
            <div className="font-mono mono-num text-[18px]">{fmtRs(r.freedCash)}</div>
            <div className="text-[10px] text-muted mt-1">
              {fmtRs(r.proceeds)} − fees {fmtRs(r.fees)} − CGT {fmtRs(r.cgt)}
            </div>
          </div>
          <div>
            <div className="label-cap mb-1.5">New weight</div>
            <div className="font-mono mono-num text-[18px]">{r.newWeightPct.toFixed(1)}%</div>
            <div className="text-[10px] text-muted mt-1">position {fmtRs(r.newValue)}</div>
          </div>
          <div>
            <div className="label-cap mb-1.5">Kept position</div>
            <div className="font-mono mono-num text-[18px]">{fmtRs(keptShares * price)}</div>
            <div className="text-[10px] text-muted mt-1">{fmtNum(keptShares)} sh at this price</div>
          </div>
        </div>
      )}

      {r && (
        <>
          <div className="mt-4 pt-3 border-t border-rule">
            <div className="label-cap mb-2">CGT this tax year ({taxYearLabel})</div>
            <div className="text-[13px]">
              Realised gain <span className="font-mono mono-num" style={{ color: r.netGain >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedRs(r.netGain)}</span>
              {" "}→ CGT at {cgtRatePct}% = <span className="font-mono mono-num font-medium">{fmtRs(r.cgt)}</span>
              {r.netGain < 0 && <span className="text-muted"> — a realised loss offsets other gains this tax year.</span>}
            </div>
            <table className="w-full text-[12px] font-mono mono-num mt-2">
              <thead>
                <tr className="border-t border-b border-ink text-left">
                  <th className="px-2 py-1 uppercase tracking-stat text-muted text-[10px]">Lot acquired</th>
                  <th className="px-2 py-1 uppercase tracking-stat text-muted text-[10px] text-right">Shares</th>
                  <th className="px-2 py-1 uppercase tracking-stat text-muted text-[10px] text-right">Cost/sh</th>
                  <th className="px-2 py-1 uppercase tracking-stat text-muted text-[10px] text-right">Gain</th>
                  <th className="px-2 py-1 uppercase tracking-stat text-muted text-[10px]">Held</th>
                </tr>
              </thead>
              <tbody>
                {r.consumed.map((c, i) => (
                  <tr key={i} className="border-b border-rule">
                    <td className="px-2 py-1">{c.acquired}</td>
                    <td className="px-2 py-1 text-right">{fmtNum(c.taken)}</td>
                    <td className="px-2 py-1 text-right">{c.costPerShare.toFixed(2)}</td>
                    <td className="px-2 py-1 text-right" style={{ color: c.gain >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedRs(c.gain)}</td>
                    <td className="px-2 py-1">{c.longTerm ? <Badge tone="default">LT</Badge> : <span className="text-muted">ST</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 pt-3 border-t border-rule text-[13px]">
            <div className="label-cap mb-1.5">Where the freed rupee lands</div>
            {r.mmfPerYear != null ? (
              <p>
                Parked at the {netRiskFreeLabel}: <span className="font-mono mono-num font-medium">{fmtRs(r.mmfPerYear)}</span>/yr after tax.
                {r.stayPerYear != null && (
                  <>
                    {" "}Staying in {symbol}: <span className="font-mono mono-num font-medium">{fmtRs(r.stayPerYear)}</span>/yr after tax on today&apos;s
                    earnings — {r.stayPerYear >= r.mmfPerYear ? "the position still out-earns the parking spot" : "the parking spot currently pays more"}.
                  </>
                )}
              </p>
            ) : (
              <p className="text-muted">No MMF benchmark available right now — the comparison is omitted rather than guessed.</p>
            )}
            <p className="text-[11px] text-muted mt-1.5">
              Selling this many shares goes through the decision gate — rationale and falsifier required. This card only does the arithmetic.
            </p>
          </div>
        </>
      )}
      {sellQty > totalShares && <p className="text-[12px] mt-2" style={{ color: "var(--negative)" }}>You hold {fmtNum(totalShares)} shares.</p>}
    </Card>
  );
}
