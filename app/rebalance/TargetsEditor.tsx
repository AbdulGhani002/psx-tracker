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
};

export function TargetsEditor({ initial }: Props) {
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
      const results = await Promise.all(
        dirty.map((r) =>
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
    const even = rows.length > 0 ? Math.floor((100 / rows.length) * 10) / 10 : 0;
    setRows((rs) => rs.map((r) => ({ ...r, target: even })));
  }

  // Keep the shape of what you decided and just make it add up. Scaling
  // preserves every relative judgement you made; distributing evenly throws
  // them all away, which is why this is the button to reach for first.
  function scaleTo100() {
    const sum = rows.reduce((s, r) => s + r.target, 0);
    if (sum <= 0) return;
    const scaled = rows.map((r) => ({ ...r, target: Math.round((r.target / sum) * 1000) / 10 }));
    // Rounding rarely lands on 100 exactly; the remainder goes to the largest
    // target, where a tenth of a point is least meaningful.
    const after = scaled.reduce((s, r) => s + r.target, 0);
    const drift = Math.round((100 - after) * 10) / 10;
    if (drift !== 0) {
      let big = 0;
      for (let i = 1; i < scaled.length; i++) if (scaled[i].target > scaled[big].target) big = i;
      scaled[big] = { ...scaled[big], target: Math.round((scaled[big].target + drift) * 10) / 10 };
    }
    setRows(scaled);
  }

  // Owning something you target at nothing is a standing instruction to sell it
  // all. Sometimes that is exactly right; more often the target was never set.
  const ownedButUntargeted = rows.filter((r) => r.currentPercent > 0.05 && r.target <= 0);

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
          {Math.abs(offBy) >= 0.05 && (
            <div className="text-[10px] font-mono text-muted">
              {offBy > 0 ? "+" : ""}{offBy.toFixed(1)}% from 100
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
                      className="ml-2 text-[10px] font-mono uppercase tracking-stat"
                      style={{ color: "var(--negative)" }}
                      title="You hold this and target nothing, so the plan reads it as sell the lot."
                    >
                      sell all
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

      {Math.abs(offBy) >= 0.05 && (
        <p className="text-[12px] mt-4 max-w-[80ch]" style={{ color: offBy < 0 ? "var(--negative)" : "var(--accent-deep)" }}>
          {offBy < 0 ? (
            <>
              These targets describe {targetSum.toFixed(1)}% of the equity book, so{" "}
              <strong>{Math.abs(offBy).toFixed(1)}% of it is spoken for by nothing.</strong> The deployment plan sizes
              every buy against these weights, so that share simply never gets bought — cash sits in the fund waiting
              for an instruction that does not exist. That is fine if you meant to hold it back, and a silent leak if
              you did not.
            </>
          ) : (
            <>
              These targets add to {targetSum.toFixed(1)}%, which is {offBy.toFixed(1)}% more book than you have. Every
              name will read as underweight forever and the plan will keep asking for money you do not have.
            </>
          )}
        </p>
      )}

      {ownedButUntargeted.length > 0 && (
        <p className="text-[12px] mt-3 max-w-[80ch]" style={{ color: "var(--negative)" }}>
          You hold {ownedButUntargeted.map((r) => r.symbol).join(", ")} but target{" "}
          {ownedButUntargeted.length === 1 ? "it" : "them"} at zero. The plan reads that as an instruction to sell the
          lot. If you meant to keep {ownedButUntargeted.length === 1 ? "it" : "them"}, give{" "}
          {ownedButUntargeted.length === 1 ? "it a weight" : "them weights"} — a blank target is not the same as no
          opinion.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 mt-5">
        <Button variant="solid" onClick={saveAll} disabled={saving}>
          {saving ? "Saving…" : "Save Targets"}
        </Button>
        {Math.abs(offBy) >= 0.05 && targetSum > 0 && (
          <Button variant="outline" onClick={scaleTo100}>
            Scale to 100%
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
