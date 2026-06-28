"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Row = {
  symbol: string; name: string | null; sector: string | null; price: number | null; change_pct: number | null;
  pe: number | null; dividend_yield_pct: number | null; rsi14: number | null; eps_cagr_pct: number | null;
  net_margin_pct: number | null; overall: number; verdict: string;
};

const NUMS: { key: string; label: string; placeholder?: string }[] = [
  { key: "pe_max", label: "P/E ≤" },
  { key: "div_yield_min", label: "Div yield ≥ %" },
  { key: "margin_min", label: "Net margin ≥ %" },
  { key: "eps_growth_min", label: "EPS growth ≥ %" },
  { key: "rsi_min", label: "RSI ≥" },
  { key: "rsi_max", label: "RSI ≤" },
  { key: "vol_spike_min", label: "Vol spike ≥ ×" },
  { key: "mcap_min", label: "Mkt cap ≥ (000)" },
];
const BOOLS: { key: string; label: string }[] = [
  { key: "above_sma50", label: "Above SMA-50" },
  { key: "above_sma200", label: "Above SMA-200" },
  { key: "macd_positive", label: "MACD positive" },
  { key: "golden_cross", label: "Golden cross" },
];

const verdictColor = (v: string) => (v === "strong" || v === "good" ? "var(--positive)" : v === "weak" ? "var(--negative)" : "var(--muted)");

export function ScreenerClient() {
  const [nums, setNums] = useState<Record<string, string>>({});
  const [bools, setBools] = useState<Record<string, boolean>>({});
  const [sector, setSector] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [sectors, setSectors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (sector) p.set("sector", sector);
    for (const { key } of NUMS) if (nums[key] !== undefined && nums[key] !== "") p.set(key, nums[key]);
    for (const { key } of BOOLS) if (bools[key]) p.set(key, "true");
    p.set("limit", "150");
    return p.toString();
  }, [nums, bools, sector]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/market/screen?${qs}`);
        const d = await res.json();
        if (!alive) return;
        const results: Row[] = d.results || [];
        setRows(results);
        if (sectors.length === 0) setSectors([...new Set(results.map((r) => r.sector).filter(Boolean) as string[])].sort());
      } catch {
        if (alive) setRows([]);
      } finally {
        if (alive) setLoading(false);
      }
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [qs]); // eslint-disable-line

  const reset = () => { setNums({}); setBools({}); setSector(""); };

  return (
    <div>
      <div className="border border-rule p-4 mb-5" style={{ background: "var(--paper-2)" }}>
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3">
          <label className="block">
            <span className="label-cap block mb-1">Sector</span>
            <select value={sector} onChange={(e) => setSector(e.target.value)} className="w-full border border-rule bg-transparent px-2 py-1.5 text-[13px]">
              <option value="">All sectors</option>
              {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          {NUMS.map((n) => (
            <label key={n.key} className="block">
              <span className="label-cap block mb-1">{n.label}</span>
              <input type="number" value={nums[n.key] ?? ""} onChange={(e) => setNums((p) => ({ ...p, [n.key]: e.target.value }))} className="w-full border border-rule bg-transparent px-2 py-1.5 text-[13px] font-mono" />
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-4">
          {BOOLS.map((b) => (
            <label key={b.key} className="flex items-center gap-1.5 text-[12px] cursor-pointer">
              <input type="checkbox" checked={!!bools[b.key]} onChange={(e) => setBools((p) => ({ ...p, [b.key]: e.target.checked }))} />
              <span className="label-cap">{b.label}</span>
            </label>
          ))}
          <button onClick={reset} className="ml-auto font-mono text-[11px] uppercase tracking-stat text-muted hover:text-[var(--accent-deep)]">Reset</button>
        </div>
      </div>

      <div className="flex items-baseline justify-between mb-2">
        <span className="label-cap">{loading ? "screening…" : `${rows.length} matches`}</span>
      </div>
      <div className="overflow-x-auto" style={{ opacity: loading ? 0.5 : 1, transition: "opacity 150ms" }}>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-t border-ink border-b border-ink">
              {["Symbol", "Sector", "Price", "Day", "P/E", "Div%", "RSI", "Margin", "EPS CAGR", "AI", "Verdict"].map((h, i) => (
                <th key={h} className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium" style={{ textAlign: i >= 2 && i <= 8 ? "right" : "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol} className="border-b border-rule hover:bg-[var(--paper-2)]">
                <td className="px-2 py-1.5"><Link href={`/stock/${r.symbol}`} className="font-mono font-medium hover:text-[var(--accent-deep)]">{r.symbol}</Link></td>
                <td className="px-2 py-1.5 text-muted text-[11px] truncate max-w-[150px]">{(r.sector || "").split(" ").slice(0, 2).join(" ")}</td>
                <td className="px-2 py-1.5 text-right font-mono mono-num">{r.price == null ? "—" : r.price.toFixed(2)}</td>
                <td className="px-2 py-1.5 text-right font-mono mono-num" style={{ color: (r.change_pct ?? 0) >= 0 ? "var(--positive)" : "var(--negative)" }}>{r.change_pct == null ? "—" : `${r.change_pct >= 0 ? "+" : ""}${r.change_pct.toFixed(1)}`}</td>
                <td className="px-2 py-1.5 text-right font-mono mono-num text-muted">{r.pe == null ? "—" : r.pe.toFixed(1)}</td>
                <td className="px-2 py-1.5 text-right font-mono mono-num" style={{ color: "var(--positive)" }}>{r.dividend_yield_pct == null ? "—" : r.dividend_yield_pct.toFixed(1)}</td>
                <td className="px-2 py-1.5 text-right font-mono mono-num text-muted">{r.rsi14 == null ? "—" : Math.round(r.rsi14)}</td>
                <td className="px-2 py-1.5 text-right font-mono mono-num text-muted">{r.net_margin_pct == null ? "—" : `${r.net_margin_pct.toFixed(0)}%`}</td>
                <td className="px-2 py-1.5 text-right font-mono mono-num text-muted">{r.eps_cagr_pct == null ? "—" : `${r.eps_cagr_pct.toFixed(0)}%`}</td>
                <td className="px-2 py-1.5 text-right font-display mono-num text-[16px]" style={{ fontVariationSettings: "'opsz' 144" }}>{r.overall}</td>
                <td className="px-2 py-1.5"><span className="font-mono text-[11px] uppercase" style={{ color: verdictColor(r.verdict) }}>{r.verdict}</span></td>
              </tr>
            ))}
            {!loading && rows.length === 0 && <tr><td colSpan={11} className="px-2 py-8 text-center text-muted text-sm">No stocks match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
