"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { fmtRs } from "@/lib/format";

type Holding = {
  symbol: string;
  name: string;
  marketValue: number;
  inKmi30: boolean;
  inKmiAllShare: boolean;
  compliant: boolean | null;
  dividendThisYear: number;
  purificationPct: number;
};

function tag(h: Holding) {
  if (h.compliant === null) return <Badge tone="default">unknown</Badge>;
  if (h.compliant) return <Badge tone="positive">{h.inKmi30 ? "KMI-30" : "KMI All-Share"}</Badge>;
  return <Badge tone="negative">not in KMI</Badge>;
}

export function ShariahView({ initial }: { initial: Holding[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial.map((h) => ({ ...h })));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function setPct(symbol: string, v: number) {
    setRows((rs) => rs.map((r) => (r.symbol === symbol ? { ...r, purificationPct: v } : r)));
  }

  async function saveAll() {
    setSaving(true);
    try {
      const dirty = rows.filter((r, i) => r.purificationPct !== initial[i].purificationPct);
      await Promise.all(
        dirty.map((r) =>
          fetch(`/api/holdings/${r.symbol}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ purificationPctOfDividend: r.purificationPct }),
          })
        )
      );
      setSavedAt(Date.now());
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const totalCharity = rows.reduce((s, r) => s + (r.dividendThisYear * r.purificationPct) / 100, 0);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="label-cap border-t border-b border-ink" style={{ textAlign: "left" }}>
              <th className="py-2">Symbol</th>
              <th className="py-2">Shariah status</th>
              <th className="py-2 text-right">Value</th>
              <th className="py-2 text-right">Dividend (this yr)</th>
              <th className="py-2 text-right">Non-permissible %</th>
              <th className="py-2 text-right">Charity due</th>
            </tr>
          </thead>
          <tbody className="mono-num">
            {rows.map((h) => (
              <tr key={h.symbol} className="border-b border-rule">
                <td className="py-2"><span className="font-mono font-medium">{h.symbol}</span> <span className="text-muted">{h.name !== h.symbol ? h.name : ""}</span></td>
                <td className="py-2">{tag(h)}</td>
                <td className="py-2 text-right">{fmtRs(h.marketValue)}</td>
                <td className="py-2 text-right text-muted">{h.dividendThisYear > 0 ? fmtRs(h.dividendThisYear) : "—"}</td>
                <td className="py-2 text-right">
                  <input
                    type="number"
                    value={h.purificationPct || ""}
                    placeholder="0"
                    min={0}
                    max={100}
                    step={0.1}
                    onChange={(e) => setPct(h.symbol, Number(e.target.value))}
                    className="w-16 bg-transparent border-b border-ink text-right font-mono text-[13px] py-1 focus:outline-none"
                  />
                  <span className="text-muted text-[11px] ml-1">%</span>
                </td>
                <td className="py-2 text-right" style={{ color: "var(--accent-deep)" }}>
                  {h.purificationPct > 0 && h.dividendThisYear > 0 ? fmtRs((h.dividendThisYear * h.purificationPct) / 100) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-ink font-medium">
              <td className="py-2" colSpan={5}>Total charity to give (purification)</td>
              <td className="py-2 text-right" style={{ color: "var(--accent-deep)" }}>{fmtRs(totalCharity)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="flex items-center gap-3 mt-4">
        <button onClick={saveAll} disabled={saving} className="inline-flex items-center justify-center px-4 py-2 text-[12px] font-medium uppercase tracking-button bg-ink text-paper border border-ink hover:bg-[var(--accent-deep)] disabled:opacity-40">
          {saving ? "Saving…" : "Save purification %"}
        </button>
        {savedAt && Date.now() - savedAt < 3500 && <span className="text-[12px]" style={{ color: "var(--positive)" }}>Saved.</span>}
      </div>
      <p className="text-[11px] text-muted mt-3 max-w-[82ch]">
        Enter each company&apos;s non-permissible income % from AlMeezan / Meezan Bank&apos;s annual purification report. The charity
        due is that % of the dividends you received this tax year — give it away to purify your return. KMI status comes from
        live PSX index membership (the KMI indices are Meezan-screened), refreshed as the index rebalances.
      </p>
    </div>
  );
}
