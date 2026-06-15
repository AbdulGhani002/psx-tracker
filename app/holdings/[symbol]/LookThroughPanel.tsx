"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Toggle } from "@/components/ui/Toggle";
import { Stat, StatRow } from "@/components/ui/Stat";
import { fmtRs, fmtCompact, fmtNum } from "@/lib/format";

type Constituent = { label: string; symbol: string; shares: number; ownershipPct?: number };
type Config = {
  enabled: boolean;
  constituents: Constituent[];
  unlistedValuePkr: number;
  netDebtPkr: number;
  sharesOutstanding: number;
};
type Result = {
  constituents: { label: string; symbol: string; shares: number; price: number; value: number; pctOfAssets: number; priced: boolean }[];
  listedValue: number;
  unlistedValue: number;
  netDebt: number;
  navTotal: number;
  sharesOutstanding: number;
  navPerShare: number;
  marketPrice: number;
  discountPct: number | null;
  yourMarketValue: number;
  yourLookThroughValue: number;
  missingPrices: string[];
} | null;

type Known = { name: string; listed: { label: string; symbol: string; ownershipPct: number }[]; unlisted: { label: string; note: string }[]; source: string } | null;

export function LookThroughPanel({ symbol, initial, result, known }: { symbol: string; initial: Config; result: Result; known?: Known }) {
  const router = useRouter();
  const [c, setC] = useState<Config>(initial);
  const [editing, setEditing] = useState(!initial.enabled);
  const [saving, setSaving] = useState(false);

  function setRow(i: number, k: keyof Constituent, v: string | number) {
    setC((p) => ({ ...p, constituents: p.constituents.map((row, j) => (j === i ? { ...row, [k]: v } : row)) }));
  }
  function addRow() {
    setC((p) => ({ ...p, constituents: [...p.constituents, { label: "", symbol: "", shares: 0, ownershipPct: 0 }] }));
  }
  function removeRow(i: number) {
    setC((p) => ({ ...p, constituents: p.constituents.filter((_, j) => j !== i) }));
  }
  function loadKnown() {
    if (!known) return;
    setC((p) => ({
      ...p,
      enabled: true,
      constituents: known.listed.map((k) => ({ label: k.label, symbol: k.symbol, shares: 0, ownershipPct: k.ownershipPct })),
    }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/holdings/${symbol}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lookThrough: {
            enabled: c.enabled,
            constituents: c.constituents.filter((r) => r.symbol.trim()).map((r) => ({ label: r.label, symbol: r.symbol.toUpperCase().trim(), shares: r.shares, ownershipPct: r.ownershipPct ?? 0 })),
            unlistedValuePkr: c.unlistedValuePkr,
            netDebtPkr: c.netDebtPkr,
            sharesOutstanding: c.sharesOutstanding,
          },
        }),
      });
      if (res.ok) {
        setEditing(false);
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  const disc = result?.discountPct ?? null;

  return (
    <div className="space-y-5">
      {result && c.enabled && !editing && (
        <Card>
          <StatRow>
            <Stat label="Look-through NAV / share" value={fmtRs(result.navPerShare, true)} tone="accent" size="lg" />
            <Stat label="Market price" value={fmtRs(result.marketPrice, true)} />
            <Stat
              label={disc != null && disc >= 0 ? "Discount to NAV" : "Premium to NAV"}
              value={disc != null ? `${Math.abs(disc).toFixed(0)}%` : "—"}
              tone={disc != null && disc >= 0 ? "positive" : "negative"}
              hint={disc != null && disc >= 0 ? "trading below assets" : "trading above assets"}
            />
            <Stat label="Your shares — market" value={fmtCompact(result.yourMarketValue)} tone="muted" />
            <Stat label="Your shares — assets" value={fmtCompact(result.yourLookThroughValue)} tone="muted" hint="look-through value" />
          </StatRow>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="label-cap" style={{ textAlign: "left" }}>
                  <th className="py-1">Company</th>
                  <th className="py-1 text-right">Shares owned</th>
                  <th className="py-1 text-right">Price</th>
                  <th className="py-1 text-right">Value</th>
                  <th className="py-1 text-right">% of assets</th>
                </tr>
              </thead>
              <tbody className="mono-num">
                {result.constituents.map((r) => (
                  <tr key={r.symbol} className="border-t border-rule">
                    <td className="py-1.5"><span className="font-mono font-medium">{r.symbol}</span> <span className="text-muted">{r.label && r.label !== r.symbol ? r.label : ""}</span></td>
                    <td className="py-1.5 text-right">{fmtNum(r.shares)}</td>
                    <td className="py-1.5 text-right">{r.priced ? fmtRs(r.price, true) : <span style={{ color: "var(--negative)" }}>no price</span>}</td>
                    <td className="py-1.5 text-right">{fmtCompact(r.value)}</td>
                    <td className="py-1.5 text-right text-muted">{r.pctOfAssets.toFixed(1)}%</td>
                  </tr>
                ))}
                {result.unlistedValue > 0 && (
                  <tr className="border-t border-rule"><td className="py-1.5 text-muted">Unlisted / other</td><td /><td /><td className="py-1.5 text-right">{fmtCompact(result.unlistedValue)}</td><td /></tr>
                )}
                {result.netDebt > 0 && (
                  <tr className="border-t border-rule"><td className="py-1.5 text-muted">Net debt</td><td /><td /><td className="py-1.5 text-right" style={{ color: "var(--negative)" }}>−{fmtCompact(result.netDebt)}</td><td /></tr>
                )}
                <tr className="border-t border-ink font-medium">
                  <td className="py-1.5">Look-through NAV</td><td /><td /><td className="py-1.5 text-right">{fmtCompact(result.navTotal)}</td>
                  <td className="py-1.5 text-right text-muted">{fmtNum(Math.round(result.sharesOutstanding))} sh</td>
                </tr>
              </tbody>
            </table>
          </div>
          {result.missingPrices.length > 0 && (
            <p className="text-[11px] mt-3" style={{ color: "var(--negative)" }}>
              No live price for: {result.missingPrices.join(", ")} — those are excluded, so the NAV is understated. Check the symbols.
            </p>
          )}
          <div className="mt-4"><Button variant="outline" onClick={() => setEditing(true)}>Edit constituents</Button></div>
        </Card>
      )}

      {(editing || !c.enabled) && (
        <Card>
          <Toggle label="Value this as a holding company (look-through)" value={c.enabled} onChange={(v) => setC((p) => ({ ...p, enabled: v }))} hint="Sum the live value of the stakes it owns and compare to its market price." />
          {c.enabled && (
            <div className="mt-4 space-y-3">
              <p className="text-[12px] text-muted max-w-[74ch]">
                Add each listed company this one owns. Give either the <b>stake %</b> (from the annual report — shares are then
                derived from that company&apos;s own shares outstanding) or an exact <b>share count</b>. Prices are pulled live.
                The holding-co shares-outstanding auto-derives from earnings if left 0.
              </p>
              <div className="grid grid-cols-12 gap-2 label-cap">
                <span className="col-span-3">Name</span>
                <span className="col-span-2">Symbol</span>
                <span className="col-span-3 text-right">Stake %</span>
                <span className="col-span-3 text-right">or shares</span>
                <span className="col-span-1" />
              </div>
              <div className="space-y-2">
                {c.constituents.map((row, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <input className="col-span-3 bg-transparent border-b border-rule text-[13px] py-1" placeholder="Name" value={row.label} onChange={(e) => setRow(i, "label", e.target.value)} />
                    <input className="col-span-2 bg-transparent border-b border-rule text-[13px] py-1 font-mono uppercase" placeholder="SYM" value={row.symbol} onChange={(e) => setRow(i, "symbol", e.target.value)} />
                    <input className="col-span-3 bg-transparent border-b border-rule text-[13px] py-1 font-mono text-right" type="number" placeholder="%" value={row.ownershipPct || ""} onChange={(e) => setRow(i, "ownershipPct", Number(e.target.value))} />
                    <input className="col-span-3 bg-transparent border-b border-rule text-[13px] py-1 font-mono text-right" type="number" placeholder="shares" value={row.shares || ""} onChange={(e) => setRow(i, "shares", Number(e.target.value))} />
                    <button className="col-span-1 text-[11px] text-muted hover:text-[var(--negative)]" onClick={() => removeRow(i)}>✕</button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-4">
                <button className="label-cap hover:text-[var(--accent-deep)]" onClick={addRow}>+ Add company</button>
                {known && (
                  <button className="label-cap hover:text-[var(--accent-deep)]" style={{ color: "var(--accent)" }} onClick={loadKnown}>
                    ↻ Load {known.name}&apos;s known stakes
                  </button>
                )}
              </div>
              {known && known.unlisted.length > 0 && (
                <p className="text-[11px] text-muted max-w-[74ch]">
                  Also owns (unlisted — no PSX price; add their value to &quot;Unlisted / other&quot; below):{" "}
                  {known.unlisted.map((u) => `${u.label} ${u.note}`).join("; ")}. Source: {known.source}.
                </p>
              )}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3">
                <label className="block"><span className="label-cap">Unlisted / other assets (Rs)</span><input className="w-full bg-transparent border-b border-ink text-[14px] py-1 font-mono" type="number" value={c.unlistedValuePkr || ""} onChange={(e) => setC((p) => ({ ...p, unlistedValuePkr: Number(e.target.value) }))} /></label>
                <label className="block"><span className="label-cap">Net debt (Rs)</span><input className="w-full bg-transparent border-b border-ink text-[14px] py-1 font-mono" type="number" value={c.netDebtPkr || ""} onChange={(e) => setC((p) => ({ ...p, netDebtPkr: Number(e.target.value) }))} /></label>
                <label className="block"><span className="label-cap">Shares outstanding (0 = auto)</span><input className="w-full bg-transparent border-b border-ink text-[14px] py-1 font-mono" type="number" value={c.sharesOutstanding || ""} onChange={(e) => setC((p) => ({ ...p, sharesOutstanding: Number(e.target.value) }))} /></label>
              </div>
            </div>
          )}
          <div className="flex items-center gap-3 mt-5 pt-4 border-t border-rule">
            <Button variant="solid" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            {initial.enabled && <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>}
          </div>
        </Card>
      )}
    </div>
  );
}
