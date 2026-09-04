"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { fmtPct } from "@/lib/format";

type Row = {
  symbol: string;
  sector: string;
  currentPercent: number;
  target: number;
  band: number;
};

type Props = {
  initial: Array<{
    symbol: string;
    sector: string;
    currentPercent: number;
    targetPercent: number;
    rebalanceBand: number;
  }>;
  strictZones: boolean;
};

export function TargetsEditor({ initial, strictZones }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(
    initial.map((p) => ({
      symbol: p.symbol,
      sector: p.sector,
      currentPercent: p.currentPercent,
      target: p.targetPercent,
      band: p.rebalanceBand,
    }))
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [strict, setStrict] = useState(strictZones);
  const [error, setError] = useState<string | null>(null);

  function updateRow(symbol: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.symbol === symbol ? { ...r, ...patch } : r)));
  }

  const targetSum = rows.reduce((s, r) => s + r.target, 0);
  const offBy = targetSum - 100;

  async function saveAll() {
    setSaving(true);
    setError(null);
    try {
      const dirty = rows.filter(
        (r, i) =>
          r.target !== initial[i].targetPercent || r.band !== initial[i].rebalanceBand
      );

      // The buy-zone switch is a setting rather than a per-holding field.
      if (strict !== strictZones) {
        const res = await fetch("/api/settings", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ strictBuyZones: strict }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body?.detail ?? body?.error ?? "Could not save the buy-zone setting.");
          return;
        }
      }

      const results = await Promise.all(
        dirty
          .map((r) =>
            fetch(`/api/holdings/${r.symbol}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                targetAllocationPercent: r.target,
                rebalanceBand: r.band,
              }),
            })
          )
      );
      const failed = results.find((r) => !r.ok);
      if (failed) {
        const body = await failed.json().catch(() => ({}));
        setError(body?.detail ?? body?.error ?? "Some updates failed.");
        return;
      }
      setSavedAt(Date.now());
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  function distributeEvenly() {
    // Only the names actually in the plan share the allocatable book. Handing a
    // slice to something you are winding down would silently re-buy it.
    const outOfPlan = rows.filter((r) => r.currentPercent > 0.05 && r.target <= 0);
    const inPlan = rows.filter((r) => !outOfPlan.some((x) => x.symbol === r.symbol));
    const goal = 100 - outOfPlan.reduce((s, r) => s + r.currentPercent, 0);
    const even = inPlan.length > 0 ? Math.floor((goal / inPlan.length) * 10) / 10 : 0;
    setRows((rs) => rs.map((r) => (inPlan.some((x) => x.symbol === r.symbol) ? { ...r, target: even } : r)));
  }

  // Keep the shape of what you decided and just make it add up. Scaling
  // preserves every relative judgement you made; distributing evenly throws
  // them all away, which is why this is the button to reach for first.
  function scaleTo100() {
    const sum = rows.reduce((s, r) => s + r.target, 0);
    if (sum <= 0) return;
    // Scale to what is actually allocatable: a book with part of it winding
    // down has less than 100% to share out.
    const goal = expectedSum;
    const scaled = rows.map((r) => ({ ...r, target: Math.round((r.target / sum) * goal * 10) / 10 }));
    // Rounding rarely lands on 100 exactly; the remainder goes to the largest
    // target, where a tenth of a point is least meaningful.
    const after = scaled.reduce((s, r) => s + r.target, 0);
    const drift = Math.round((goal - after) * 10) / 10;
    if (drift !== 0) {
      let big = 0;
      for (let i = 1; i < scaled.length; i++) if (scaled[i].target > scaled[big].target) big = i;
      scaled[big] = { ...scaled[big], target: Math.round((scaled[big].target + drift) * 10) / 10 };
    }
    setRows(scaled);
  }

  // Owning something you target at nothing is a standing instruction to sell it
  // all. Sometimes that is exactly right; more often the target was never set.
  // Held at a zero target. That is a decision, not an omission: no new money
  // in, and the exit is governed by your own sell price. It does mean this
  // weight is outside the target plan, which is what the total has to allow for.
  const windingDown = rows.filter((r) => r.currentPercent > 0.05 && r.target <= 0);
  const windingDownPct = windingDown.reduce((s, r) => s + r.currentPercent, 0);
  // What the targets ought to add up to today, given part of the book is on its
  // way out and deliberately unallocated.
  const expectedSum = 100 - windingDownPct;
  const offPlan = targetSum - expectedSum;

  if (rows.length === 0) return null;

  return (
    <Card>
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <div className="label-cap">Set targets</div>
          <p className="text-[12px] text-muted mt-1">
            Editable in one place. Save commits the new target % and rebalance band to each holding.
          </p>
        </div>
        <div className="text-right">
          <div className="label-cap">Total</div>
          <div
            className="font-display mono-num text-[20px]"
            style={{

              color:
                Math.abs(offBy) < 0.05
                  ? "var(--positive)"
                  : Math.abs(offBy) <= 1
                  ? "var(--accent-deep)"
                  : "var(--negative)",
            }}
          >
            {targetSum.toFixed(1)}%
          </div>
          {Math.abs(offPlan) >= 0.05 && (
            <div className="text-[10px] font-mono text-muted">
              {offPlan > 0 ? "+" : ""}
              {offPlan.toFixed(1)}% from {expectedSum.toFixed(1)}
            </div>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-t border-ink border-b border-ink">
              <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium text-left">Symbol</th>
              <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium text-left">Sector</th>
              <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium text-right">Current %</th>
              <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium text-right">Target %</th>
              <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium text-right">Band ±</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol} className="border-b border-rule">
                <td className="px-3 py-2 font-mono font-medium">{r.symbol}</td>
                <td className="px-3 py-2 text-[12px] text-muted">{r.sector}</td>
                <td className="px-3 py-2 text-right font-mono mono-num">
                  {fmtPct(r.currentPercent / 100, 1)}
                  {r.currentPercent > 0.05 && r.target <= 0 && (
                    <span
                      className="ml-2 text-[10px] font-mono uppercase tracking-stat text-muted"
                      title="Held at a zero target: no new buying, and it leaves on its own sell price rather than on a weight rule."
                    >
                      wind down
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="number"
                    value={r.target}
                    onChange={(e) => updateRow(r.symbol, { target: Number(e.target.value) })}
                    step={0.5}
                    min={0}
                    max={100}
                    className="w-20 bg-transparent border-b border-ink text-right font-mono mono-num text-[13px] py-1 focus:outline-none"
                  />
                  <span className="ml-1 text-muted text-[11px]">%</span>
                </td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="number"
                    value={r.band}
                    onChange={(e) => updateRow(r.symbol, { band: Number(e.target.value) })}
                    step={0.5}
                    min={0}
                    max={50}
                    className="w-16 bg-transparent border-b border-ink text-right font-mono mono-num text-[13px] py-1 focus:outline-none"
                  />
                  <span className="ml-1 text-muted text-[11px]">%</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && (
        <div className="text-[13px] mt-3" style={{ color: "var(--negative)" }}>
          {error}
        </div>
      )}

      {windingDown.length > 0 && (
        <p className="text-[12px] mt-4 max-w-[80ch] text-muted">
          {windingDown.map((r) => r.symbol).join(", ")} {windingDown.length === 1 ? "is" : "are"} held at a zero
          target, which is read as winding down: no new money in, and{" "}
          {windingDown.length === 1 ? "it leaves" : "they leave"} on the sell price you set rather than on a weight
          rule. That is {windingDownPct.toFixed(1)}% of the book deliberately outside the target plan, so the targets
          below should add to <strong>{expectedSum.toFixed(1)}%</strong> rather than 100%.
        </p>
      )}

      {Math.abs(offPlan) >= 0.05 && (
        <p className="text-[12px] mt-3 max-w-[80ch]" style={{ color: offPlan < 0 ? "var(--negative)" : "var(--accent-deep)" }}>
          {offPlan < 0 ? (
            <>
              They add to {targetSum.toFixed(1)}%, so{" "}
              <strong>{Math.abs(offPlan).toFixed(1)}% of the book is spoken for by nothing.</strong> Every buy is sized
              against these weights, so that share never gets bought — cash waits in the fund for an instruction that
              does not exist. Deliberate cash is fine; this is cash by accident.
            </>
          ) : (
            <>
              They add to {targetSum.toFixed(1)}%, which is {offPlan.toFixed(1)}% more book than there is to allocate.
              Every name will read as underweight forever and the plan will keep asking for money you do not have.
            </>
          )}
        </p>
      )}

      <label className="flex items-start gap-3 mt-4 cursor-pointer max-w-[80ch]">
        <input
          type="checkbox"
          checked={strict}
          onChange={(e) => setStrict(e.target.checked)}
          className="mt-1"
        />
        <span className="text-[12px]">
          <span className="font-medium">Only buy inside the buy zone.</span>{" "}
          <span className="text-muted">
            Off, a price above your ceiling still gets bought, just less of it. On, a name outside its band is not
            bought at all and the money stays in cash until the price comes to you. A name with no band set counts as
            outside it, because an unproven price is not a cheap one.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3 mt-5">
        <Button variant="solid" onClick={saveAll} disabled={saving}>
          {saving ? "Saving…" : "Save Targets"}
        </Button>
        {Math.abs(offPlan) >= 0.05 && targetSum > 0 && (
          <Button variant="outline" onClick={scaleTo100}>
            Scale to {expectedSum.toFixed(1)}%
          </Button>
        )}
        <Button variant="outline" onClick={distributeEvenly}>
          Distribute Evenly
        </Button>
        {savedAt && Date.now() - savedAt < 3500 && (
          <span className="text-[12px]" style={{ color: "var(--positive)" }}>
            Saved.
          </span>
        )}
      </div>
    </Card>
  );
}
