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

      <div className="flex flex-wrap items-center gap-3 mt-5">
        <Button variant="solid" onClick={saveAll} disabled={saving}>
          {saving ? "Saving…" : "Save Targets"}
        </Button>
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
